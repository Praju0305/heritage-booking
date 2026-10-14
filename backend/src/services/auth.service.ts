import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User, UserDoc, Role } from '../models/User';
import { conflict, unauthorized } from '../utils/errors';

export interface TokenClaims {
  sub: string;
  role: Role; // convenience for the UI only; the server never trusts it for authorisation
}

const BCRYPT_COST = 10;
// Pre-computed hash so login takes the same time whether or not the e-mail exists (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export function signToken(user: UserDoc): string {
  const claims: TokenClaims = { sub: user.id, role: user.role };
  return jwt.sign(claims, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

/**
 * Strict verification: signature, algorithm allow-list (HS256 only), issuer,
 * audience and expiry are all enforced. Throws 401 on any failure.
 */
export function verifyToken(token: string): TokenClaims {
  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: [...config.jwt.algorithms],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad payload');
    return payload as unknown as TokenClaims;
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/**
 * Resolve a token to the CURRENT user record. Authorisation decisions use the
 * role stored in the database, never the role claim in the token, so a forged
 * or stale claim cannot grant (or keep) admin rights.
 */
export async function authenticate(token: string): Promise<{ id: string; role: Role; name: string; email: string }> {
  const claims = verifyToken(token);
  const user = await User.findById(claims.sub).lean();
  if (!user) throw unauthorized('Account no longer exists');
  return { id: String(user._id), role: user.role as Role, name: user.name, email: user.email };
}

export async function register(input: { name: string; email: string; password: string }) {
  const exists = await User.exists({ email: input.email.toLowerCase() });
  if (exists) throw conflict('E-mail already registered', 'EMAIL_TAKEN');
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  try {
    // role is deliberately NOT taken from input: every public signup is a plain "user".
    const user = await User.create({ name: input.name, email: input.email, passwordHash, role: 'user' });
    return { token: signToken(user), user: publicUser(user) };
  } catch (err: any) {
    if (err?.code === 11000) throw conflict('E-mail already registered', 'EMAIL_TAKEN');
    throw err;
  }
}

export async function login(input: { email: string; password: string }) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid e-mail or password');
  return { token: signToken(user), user: publicUser(user) };
}

export const publicUser = (u: UserDoc) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
