import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { asyncHandler as h } from '../utils/asyncHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as auth from '../controllers/auth.controller';
import * as booking from '../controllers/booking.controller';
import * as capacity from '../controllers/capacity.controller';
import {
  createReservationSchema,
  createSlotSchema,
  dateQuerySchema,
  idParamSchema,
  loginSchema,
  registerSchema,
  slotsQuerySchema,
} from '../controllers/schemas';

const api = Router();

// Brute-force protection on credential endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

api.get('/health', (_req, res) => res.json({ ok: true }));

// ---- Auth ----
api.post('/auth/register', authLimiter, validate(registerSchema), h(auth.register));
api.post('/auth/login', authLimiter, validate(loginSchema), h(auth.login));
api.get('/auth/me', requireAuth, h(auth.me));

// ---- Catalogue & capacity (any authenticated user) ----
api.get('/sites', requireAuth, h(capacity.sites));
api.get('/sites/:id/slots', requireAuth, validate(idParamSchema, 'params'), validate(slotsQuerySchema, 'query'), h(capacity.siteSlots));
api.get('/slots/:id', requireAuth, validate(idParamSchema, 'params'), h(capacity.slot));

// ---- Reservations ----
api.post('/reservations', requireAuth, validate(createReservationSchema), h(booking.create));
api.get('/reservations/mine', requireAuth, h(booking.mine));
// Ownership is enforced inside the service query (IDOR-safe); the id is only a lookup key.
api.delete('/reservations/:id', requireAuth, validate(idParamSchema, 'params'), h(booking.cancel));

// ---- Admin ----
const admin = Router();
admin.use(requireAuth, requireRole('admin'));
admin.get('/capacity', validate(dateQuerySchema, 'query'), h(capacity.matrix));
admin.post('/slots', validate(createSlotSchema), h(capacity.createSlot));
api.use('/admin', admin);

export default api;
