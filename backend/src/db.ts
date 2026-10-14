import mongoose from 'mongoose';
import { config } from './config';
import { TimeSlot } from './models/TimeSlot';
import { User } from './models/User';
import { Site } from './models/Site';
import { Reservation } from './models/Reservation';

/** Retry the initial connection: in docker-compose the replica set may still be electing a primary. */
export async function connectDb(retries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      break;
    } catch (err) {
      if (attempt >= retries) throw err;
      // eslint-disable-next-line no-console
      console.warn(`MongoDB not ready (attempt ${attempt}/${retries}), retrying...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  await Promise.all([User.init(), Site.init(), TimeSlot.init(), Reservation.init()]); // build indexes
  await ensureSlotValidator();
}

/**
 * Database-level guard rail: even a buggy update cannot persist a negative
 * inventory or one larger than the slot capacity.
 */
async function ensureSlotValidator(): Promise<void> {
  const validator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['capacity', 'availableTickets'],
      properties: {
        capacity: { bsonType: ['int', 'long', 'double'], minimum: 1 },
        availableTickets: { bsonType: ['int', 'long', 'double'], minimum: 0 },
      },
    },
    // $expr lets us compare two fields: available can never exceed capacity.
    $expr: { $lte: ['$availableTickets', '$capacity'] },
  };
  const db = mongoose.connection.db!;
  try {
    await db.command({ collMod: 'timeslots', validator, validationLevel: 'strict', validationAction: 'error' });
  } catch (err: any) {
    // 26 = NamespaceNotFound -> collection does not exist yet.
    if (err?.code === 26) {
      await db.createCollection('timeslots', { validator, validationLevel: 'strict', validationAction: 'error' });
    } else {
      throw err;
    }
  }
}
