import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

// `.strict()` everywhere: unexpected keys (role, isAdmin, $where ...) are rejected, not ignored.
export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(128),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const idParamSchema = z.object({ id: objectId }).strict();

export const slotsQuerySchema = z.object({ date: isoDate }).strict();
export const dateQuerySchema = z.object({ date: isoDate }).strict();

export const createReservationSchema = z
  .object({
    slotId: objectId,
    quantity: z.number().int().min(1).max(10),
  })
  .strict();

export const createSlotSchema = z
  .object({
    siteId: objectId,
    date: isoDate,
    startTime: hhmm,
    endTime: hhmm,
    capacity: z.number().int().min(1).max(100000),
  })
  .strict();
