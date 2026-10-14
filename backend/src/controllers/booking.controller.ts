import { Request, Response } from 'express';
import * as bookingService from '../services/booking.service';
import { badRequest } from '../utils/errors';

export async function create(req: Request, res: Response) {
  const rawKey = req.header('Idempotency-Key');
  if (rawKey !== undefined && (rawKey.length < 8 || rawKey.length > 128)) {
    throw badRequest('Idempotency-Key must be 8-128 characters', 'VALIDATION_ERROR');
  }
  // userId comes from the verified identity, NEVER from the request body.
  const { reservation, slot, replayed } = await bookingService.createReservation({
    userId: req.user!.id,
    slotId: req.body.slotId,
    quantity: req.body.quantity,
    idempotencyKey: rawKey,
  });
  res.status(replayed ? 200 : 201).json({
    reservation: {
      id: String(reservation._id),
      bookingRef: reservation.bookingRef,
      slotId: String(reservation.slot),
      siteId: String(reservation.site),
      quantity: reservation.quantity,
      status: reservation.status,
    },
    availableTickets: slot ? slot.availableTickets : undefined,
    replayed,
  });
}

export async function cancel(req: Request, res: Response) {
  const r = await bookingService.cancelReservation({
    reservationId: req.params.id,
    actor: { id: req.user!.id, role: req.user!.role },
  });
  res.json({ reservation: { id: String(r._id), bookingRef: r.bookingRef, status: r.status } });
}

export async function mine(req: Request, res: Response) {
  const items = await bookingService.listMyReservations(req.user!.id);
  res.json({
    reservations: items.map((r: any) => ({
      id: String(r._id),
      bookingRef: r.bookingRef,
      quantity: r.quantity,
      status: r.status,
      createdAt: r.createdAt,
      site: r.site ? { id: String(r.site._id), name: r.site.name } : null,
      slot: r.slot ? { id: String(r.slot._id), date: r.slot.date, startTime: r.slot.startTime, endTime: r.slot.endTime } : null,
    })),
  });
}
