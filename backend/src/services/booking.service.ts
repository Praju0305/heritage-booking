import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { Reservation } from '../models/Reservation';
import { TimeSlot } from '../models/TimeSlot';
import { Role } from '../models/User';
import { AppError, conflict, notFound } from '../utils/errors';
import { KeyedMutex } from '../utils/keyedMutex';
import { publishReservation, publishSlotUpdated } from '../utils/events';

/** Queue per slot id: requests for one slot are processed one at a time per API process. */
const slotQueue = new KeyedMutex();

const TX_OPTIONS = {
  readConcern: { level: 'snapshot' as const },
  writeConcern: { w: 'majority' as const },
  readPreference: 'primary' as const,
};

const newBookingRef = () => 'HB-' + crypto.randomBytes(4).toString('hex').toUpperCase();

interface SlotLike {
  _id: Types.ObjectId;
  site: Types.ObjectId;
  date: string;
  startTime: string;
  capacity: number;
  availableTickets: number;
  version: number;
}

const toSlotEvent = (s: SlotLike) => ({
  slotId: String(s._id),
  siteId: String(s.site),
  date: s.date,
  startTime: s.startTime,
  capacity: s.capacity,
  available: s.availableTickets,
  version: s.version,
});

/**
 * BOOK TICKETS
 *
 * TOCTOU-free by construction: there is no "read availability, then decide,
 * then write" window. The check and the decrement happen in ONE atomic
 * document operation:
 *
 *   findOneAndUpdate(
 *     { _id, status: 'open', startsAt > now, availableTickets >= qty },   <- check
 *     { $inc: { availableTickets: -qty, version: 1 } }                    <- use
 *   )
 *
 * MongoDB applies this under a document-level lock, so of N concurrent
 * requests competing for the last tickets exactly the ones that still fit
 * match the filter; the rest match nothing and get a clean SOLD_OUT.
 *
 * It runs inside an ACID multi-document transaction together with the
 * Reservation insert, so either both the decrement and the reservation exist
 * or neither does (no phantom inventory loss, no reservation without stock).
 * `withTransaction` transparently retries TransientTransactionError (write
 * conflicts between concurrent transactions).
 */
export async function createReservation(input: {
  userId: string;
  slotId: string;
  quantity: number;
  idempotencyKey?: string;
}) {
  // Throughput optimisation only (see KeyedMutex). Safety is in the transaction below.
  return slotQueue.run(input.slotId, () => bookInTransaction(input));
}

async function bookInTransaction(input: {
  userId: string;
  slotId: string;
  quantity: number;
  idempotencyKey?: string;
}) {
  const { userId, slotId, quantity, idempotencyKey } = input;
  const session = await mongoose.startSession();
  let replayed = false;
  let reservationDoc: any = null;
  let slotDoc: SlotLike | null = null;

  try {
    await session.withTransaction(async () => {
      // withTransaction may re-run this callback on transient errors: reset state each time.
      replayed = false;
      reservationDoc = null;
      slotDoc = null;

      if (idempotencyKey) {
        const existing = await Reservation.findOne({ user: userId, idempotencyKey }).session(session);
        if (existing) {
          replayed = true;
          reservationDoc = existing;
          return;
        }
      }

      const updated = await TimeSlot.findOneAndUpdate(
        {
          _id: slotId,
          status: 'open',
          startsAt: { $gt: new Date() },
          availableTickets: { $gte: quantity }, // atomic check-and-set guard
        },
        { $inc: { availableTickets: -quantity, version: 1 } },
        { new: true, session },
      ).lean<SlotLike>();

      if (!updated) {
        // Diagnose WHY so the client gets a precise error (still inside the snapshot).
        const slot = await TimeSlot.findById(slotId).session(session).lean<SlotLike & { status: string; startsAt: Date }>();
        if (!slot) throw notFound('Time slot not found');
        if (slot.status !== 'open' || slot.startsAt <= new Date()) {
          throw conflict('This time slot is no longer open for booking', 'SLOT_CLOSED');
        }
        throw new AppError(
          409,
          'SOLD_OUT',
          slot.availableTickets === 0
            ? 'This time slot just sold out'
            : `Only ${slot.availableTickets} ticket(s) left for this time slot`,
        );
      }

      const [created] = await Reservation.create(
        [
          {
            bookingRef: newBookingRef(),
            user: userId,
            slot: slotId,
            site: updated.site,
            quantity,
            status: 'confirmed',
            idempotencyKey,
          },
        ],
        { session },
      );
      reservationDoc = created;
      slotDoc = updated;
    }, TX_OPTIONS);
  } catch (err: any) {
    // Two identical idempotent requests racing: the loser hits the unique index. Return the winner's result.
    if (err?.code === 11000 && idempotencyKey) {
      const existing = await Reservation.findOne({ user: userId, idempotencyKey });
      if (existing) return { reservation: existing, slot: null, replayed: true };
    }
    throw err;
  } finally {
    await session.endSession();
  }

  // ---- Transaction COMMITTED. Only now notify listeners. ----
  if (!replayed && slotDoc && reservationDoc) {
    publishSlotUpdated(toSlotEvent(slotDoc));
    publishReservation({
      type: 'created',
      reservationId: String(reservationDoc._id),
      bookingRef: reservationDoc.bookingRef,
      slotId,
      siteId: String((slotDoc as SlotLike).site),
      quantity,
      at: new Date().toISOString(),
    });
  }
  return { reservation: reservationDoc, slot: slotDoc as SlotLike | null, replayed };
}

/**
 * CANCEL A RESERVATION (IDOR-safe)
 *
 * Ownership is part of the query filter itself, not a separate "fetch then
 * compare" step, so a user can only ever match their OWN confirmed reservation.
 * For somebody else's id the filter matches nothing and we answer 404 (not 403)
 * so ids cannot be probed for existence. Admins may cancel any reservation.
 *
 * Flipping status confirmed -> cancelled is atomic and happens at most once,
 * so tickets are released exactly once even if the user double-clicks.
 */
export async function cancelReservation(input: { reservationId: string; actor: { id: string; role: Role } }) {
  const { reservationId, actor } = input;
  const session = await mongoose.startSession();
  let slotDoc: SlotLike | null = null;
  let cancelled: any = null;

  try {
    await session.withTransaction(async () => {
      slotDoc = null;
      cancelled = null;

      const filter: Record<string, unknown> = { _id: reservationId, status: 'confirmed' };
      if (actor.role !== 'admin') filter.user = actor.id; // resource-level authorisation

      const reservation = await Reservation.findOneAndUpdate(
        filter,
        { $set: { status: 'cancelled', cancelledAt: new Date() } },
        { new: true, session },
      );
      if (!reservation) throw notFound('Reservation not found');

      const updated = await TimeSlot.findOneAndUpdate(
        { _id: reservation.slot },
        { $inc: { availableTickets: reservation.quantity, version: 1 } },
        { new: true, session },
      ).lean<SlotLike>();
      if (!updated) throw notFound('Time slot not found');

      cancelled = reservation;
      slotDoc = updated;
    }, TX_OPTIONS);
  } finally {
    await session.endSession();
  }

  publishSlotUpdated(toSlotEvent(slotDoc!));
  publishReservation({
    type: 'cancelled',
    reservationId: String(cancelled._id),
    bookingRef: cancelled.bookingRef,
    slotId: String(cancelled.slot),
    siteId: String(cancelled.site),
    quantity: cancelled.quantity,
    at: new Date().toISOString(),
  });
  return cancelled;
}

export async function listMyReservations(userId: string) {
  return Reservation.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('site', 'name')
    .populate('slot', 'date startTime endTime')
    .lean();
}
