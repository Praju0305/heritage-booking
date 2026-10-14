import { Types } from 'mongoose';
import { Site } from '../models/Site';
import { TimeSlot } from '../models/TimeSlot';
import { badRequest, notFound } from '../utils/errors';

const slotView = (s: any) => ({
  id: String(s._id),
  siteId: String(s.site),
  date: s.date,
  startTime: s.startTime,
  endTime: s.endTime,
  capacity: s.capacity,
  available: s.availableTickets,
  booked: s.capacity - s.availableTickets,
  status: s.status,
  version: s.version,
});

export async function listSites() {
  const sites = await Site.find({ active: true }).sort({ name: 1 }).lean();
  return sites.map((s) => ({
    id: String(s._id),
    name: s.name,
    slug: s.slug,
    description: s.description,
    location: s.location,
    dailyCapacity: s.dailyCapacity,
  }));
}

export async function listSlotsForSite(siteId: string, date: string) {
  const slots = await TimeSlot.find({ site: siteId, date }).sort({ startTime: 1 }).lean();
  return slots.map(slotView);
}

export async function getSlot(slotId: string) {
  const slot = await TimeSlot.findById(slotId).lean();
  if (!slot) throw notFound('Time slot not found');
  return slotView(slot);
}

/** Admin matrix: every site x every slot for one day, in a single round trip. */
export async function capacityMatrix(date: string) {
  const [sites, slots] = await Promise.all([
    Site.find({ active: true }).sort({ name: 1 }).lean(),
    TimeSlot.find({ date }).sort({ startTime: 1 }).lean(),
  ]);
  return {
    date,
    sites: sites.map((s) => ({ id: String(s._id), name: s.name })),
    slots: slots.map(slotView),
  };
}

export async function createSlot(input: {
  siteId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
}) {
  const site = await Site.findById(input.siteId).lean();
  if (!site) throw notFound('Site not found');
  const startsAt = new Date(`${input.date}T${input.startTime}:00.000Z`);
  if (Number.isNaN(startsAt.getTime())) throw badRequest('Invalid date/time');
  const slot = await TimeSlot.create({
    site: new Types.ObjectId(input.siteId),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    startsAt,
    capacity: input.capacity,
    availableTickets: input.capacity,
  });
  return slotView(slot.toObject());
}
