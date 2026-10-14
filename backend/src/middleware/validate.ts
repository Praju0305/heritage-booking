import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { badRequest } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and REPLACES req[source] with the parsed value. Schemas are
 * `.strict()`, so unknown keys (e.g. `role: "admin"`) are rejected, and typed
 * parsing blocks NoSQL operator injection such as `{ "$ne": null }`.
 */
export const validate =
  (schema: ZodSchema, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const msg = result.error.issues.map((i) => `${i.path.join('.') || source}: ${i.message}`).join('; ');
      return next(badRequest(msg, 'VALIDATION_ERROR'));
    }
    (req as any)[source] = result.data;
    next();
  };
