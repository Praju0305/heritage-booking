import { Schema, model } from 'mongoose';

const reservationSchema = new Schema(
  {
    bookingRef: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    slot: { type: Schema.Types.ObjectId, ref: 'TimeSlot', required: true },
    site: { type: Schema.Types.ObjectId, ref: 'Site', required: true },
    quantity: { type: Number, required: true, min: 1, max: 10 },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed', required: true },
    cancelledAt: { type: Date },
    // Client-supplied key so a retried POST (network blip, double click) cannot book twice.
    idempotencyKey: { type: String, maxlength: 128 },
  },
  { timestamps: true },
);

// "My reservations" listing.
reservationSchema.index({ user: 1, createdAt: -1 });
// Reconciliation / admin per-slot queries.
reservationSchema.index({ slot: 1, status: 1 });
// Idempotency: unique per user, only for documents that actually carry a key.
reservationSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const Reservation = model('Reservation', reservationSchema);
