/**
 * Central, validated configuration. The process refuses to start with a weak
 * or missing JWT secret so a misconfigured deploy can never sign forgeable tokens.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGO_URI: z.string().min(1).default('mongodb://localhost:27017/heritage?replicaSet=rs0'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  CORS_ORIGINS: z.string().default('http://localhost:8080,http://localhost:5173'),
  SEED_ON_START: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@heritage.test'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(100),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
  jwt: {
    secret: parsed.data.JWT_SECRET,
    expiresIn: parsed.data.JWT_EXPIRES_IN,
    issuer: 'heritage-booking',
    audience: 'heritage-booking-api',
    // Pinning the algorithm list defeats "alg: none" and RS/HS confusion attacks.
    algorithms: ['HS256'] as const,
  },
};
