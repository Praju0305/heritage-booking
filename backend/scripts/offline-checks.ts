import jwt from 'jsonwebtoken';
import { verifyToken } from '../src/services/auth.service';
import { config } from '../src/config';
import { KeyedMutex } from '../src/utils/keyedMutex';

const base = { iss: config.jwt.issuer, aud: config.jwt.audience };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tries: Record<string, string> = {
  valid: jwt.sign({ sub: 'abc', role: 'user' }, config.jwt.secret, { algorithm: 'HS256', expiresIn: '1h', issuer: base.iss, audience: base.aud }),
  wrongSecret: jwt.sign({ sub: 'abc', role: 'admin' }, 'x'.repeat(40), { algorithm: 'HS256', expiresIn: '1h', issuer: base.iss, audience: base.aud }),
  algNone: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'abc', role: 'admin', ...base, exp: 9999999999 })}.`,
  wrongAudience: jwt.sign({ sub: 'abc' }, config.jwt.secret, { algorithm: 'HS256', expiresIn: '1h', issuer: base.iss, audience: 'other' }),
  expired: jwt.sign({ sub: 'abc' }, config.jwt.secret, { algorithm: 'HS256', expiresIn: -10, issuer: base.iss, audience: base.aud }),
  hs512: jwt.sign({ sub: 'abc' }, config.jwt.secret, { algorithm: 'HS512', expiresIn: '1h', issuer: base.iss, audience: base.aud }),
  tamperedPayload: (() => { const [h, , s] = jwt.sign({ sub: 'abc', role: 'user' }, config.jwt.secret, { algorithm: 'HS256', issuer: base.iss, audience: base.aud }).split('.'); return `${h}.${b64({ sub: 'abc', role: 'admin', ...base })}.${s}`; })(),
};
for (const [name, t] of Object.entries(tries)) {
  let r = 'ACCEPTED'; try { verifyToken(t); } catch { r = 'rejected'; }
  console.log(name.padEnd(16), r);
}

(async () => {
  const m = new KeyedMutex(); let active = 0, maxActive = 0, other = 0; const order: number[] = [];
  await Promise.all(Array.from({ length: 200 }, (_, i) => m.run('slotA', async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 1)); order.push(i); active--; })));
  await Promise.all([m.run('a', async () => { other++; }), m.run('b', async () => { other++; })]);
  console.log('mutex: max concurrent per key =', maxActive, '| FIFO =', order.every((v, i) => v === i), '| map cleaned =', m.size === 0);
})();
