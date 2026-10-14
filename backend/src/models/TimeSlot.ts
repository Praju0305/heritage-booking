import { Schema, model } from 'mongoose';

/**
 * A bookable window at a site. `availableTickets` is the contended counter.
 *
 * Protection layers for `availableTickets >= 0`:
 *  1. Booking uses ONE atomic findOneAndUpdate whose filter requires
 *     availableTickets >= quantity (compare-and-set), inside an ACID transaction.
 *  2. `version` is bumped on every change (optimistic-concurrency token that
 *     also lets clients detect stale reads).
 *  3. A collection-level $jsonSchema validator (see db.ts) rejects any write
 *     that would make the counter negative or exceed capacity, even if a future
 *     code path forgets rule 1.
 */
const timeSlotSchema = new Schema(
  {
    site: { type: Schema.Types.ObjectId, ref: 'Site', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // YYYY-MM-DD
    startTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    endTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    startsAt: { type: Date, required: true },
    capacity: { type: Number, required: true, min: 1 },
    availableTickets: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'timeslots', versionKey: false },
);

// One slot per site/date/start. Also the main read path for "slots of a site on a date".
timeSlotSchema.index({ site: 1, date: 1, startTime: 1 }, { unique: true });
// Admin matrix reads a whole day across sites.
timeSlotSchema.index({ date: 1, startTime: 1 });

export const TimeSlot = model('TimeSlot', timeSlotSchema);
