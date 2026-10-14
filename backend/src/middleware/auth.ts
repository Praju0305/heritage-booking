import { NextFunction, Request, Response } from 'express';
import { authenticate } from '../services/auth.service';
import { Role } from '../models/User';
import { forbidden, unauthorized } from '../utils/errors';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** Requires a valid Bearer token and attaches the DB-backed user to req.user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw unauthorized();
    req.user = await authenticate(header.slice(7).trim());
    next();
  } catch (err) {
    next(err);
  }
}

/** Role gate. Must run after requireAuth. Uses the role loaded from the database. */
export const requireRole =
  (role: Role) => (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== role) return next(forbidden('Insufficient privileges'));
    next();
  };
