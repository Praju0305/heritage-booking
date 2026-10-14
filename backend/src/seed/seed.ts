/**
 * Seed data: sample heritage sites, a week of hourly time slots with initial
 * capacities, one admin and one demo visitor.
 *
 * Runs automatically on API start (SEED_ON_START=true, only when the DB is
 * empty) and can be executed manually:  npm run seed
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../config';
import { connectDb } from '../db';
import { Site } from '../models/Site';
import { TimeSlot } from '../models/TimeSlot';
import { User } from '../models/User';

const SITES = [
  { name: 'Hampi Ruins', slug: 'hampi-ruins', location: 'Hampi, Karnataka', description: 'Vijayanagara-era temples and boulder-strewn ruins.', slotCapacity: 120 },
  { name: 'Mysore Palace', slug: 'mysore-palace', location: 'Mysuru, Karnataka', description: 'Indo-Saracenic royal palace of the Wadiyars.', slotCapacity: 200 },
  { name: 'Belur Chennakeshava Temple', slug: 'belur-temple', location: 'Belur, Karnataka', description: 'Exquisite Hoysala sculpture and star-shaped plan.', slotCapacity: 60 },
  { name: 'Gol Gumbaz', slug: 'gol-gumbaz', location: 'Vijayapura, Karnataka', description: 'Mausoleum famed for its enormous dome and whispering gallery.', slotCapacity: 80 },
];

const START_HOURS = [9, 10, 11, 12, 13, 14, 15, 16];
const DAYS_AHEAD = 7;

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export async function seed(opts: { onlyIfEmpty?: boolean } = {}): Promise<void> {
  if (opts.onlyIfEmpty && (await Site.estimatedDocumentCount()) > 0) {
    // eslint-disable-next-line no-console
    console.log('Seed skipped: database already has data');
    return;
  }

  // Users (upsert so re-running is safe).
  const adminHash = await bcrypt.hash(config.SEED_ADMIN_PASSWORD, 10);
  await User.updateOne(
    { email: config.SEED_ADMIN_EMAIL },
    { $setOnInsert: { name: 'Site Admin', email: config.SEED_ADMIN_EMAIL, passwordHash: adminHash, role: 'admin' } },
    { upsert: true },
  );
  const demoHash = await bcrypt.hash('Visitor@12345', 10);
  await User.updateOne(
    { email: 'visitor@heritage.test' },
    { $setOnInsert: { name: 'Demo Visitor', email: 'visitor@heritage.test', passwordHash: demoHash, role: 'user' } },
    { upsert: true },
  );

  // Sites + slots.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const s of SITES) {
    const site = await Site.findOneAndUpdate(
      { slug: s.slug },
      {
        $setOnInsert: {
          name: s.name,
          slug: s.slug,
          location: s.location,
          description: s.description,
          dailyCapacity: s.slotCapacity * START_HOURS.length,
        },
      },
      { upsert: true, new: true },
    );

    const ops = [];
    for (let d = 0; d < DAYS_AHEAD; d++) {
      const day = new Date(today.getTime() + d * 86_400_000);
      const date = isoDate(day);
      for (const hour of START_HOURS) {
        const startTime = `${pad(hour)}:00`;
        ops.push({
          updateOne: {
            filter: { site: site._id, date, startTime },
            update: {
              $setOnInsert: {
                site: site._id,
                date,
                startTime,
                endTime: `${pad(hour + 1)}:00`,
                startsAt: new Date(`${date}T${startTime}:00.000Z`),
                capacity: s.slotCapacity,
                availableTickets: s.slotCapacity,
                status: 'open' as const,
                version: 0,
              },
            },
            upsert: true,
          },
        });
      }
    }
    await TimeSlot.bulkWrite(ops);
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${SITES.length} sites x ${DAYS_AHEAD} days x ${START_HOURS.length} slots.`);
  // eslint-disable-next-line no-console
  console.log(`Admin: ${config.SEED_ADMIN_EMAIL}  |  Visitor: visitor@heritage.test`);
}

// Allow `npm run seed` / `node dist/seed/seed.js`
if (require.main === module) {
  connectDb()
    .then(() => seed())
    .then(() => mongoose.disconnect())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
