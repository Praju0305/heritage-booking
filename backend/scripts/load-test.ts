/**
 * Concurrency load test: proves the system never oversells.
 *
 *   npm run load-test            (API must be running; default http://localhost:4000)
 *   API_URL=http://localhost:8080 CAPACITY=50 REQUESTS=400 npm run load-test
 *
 * What it does:
 *  1. Logs in as admin and creates a brand-new slot with CAPACITY tickets.
 *  2. Registers USERS visitors.
 *  3. Fires REQUESTS booking requests at the SAME slot simultaneously
 *     (mix of quantity 1 and 2).
 *  4. Reconciles: tickets granted == capacity - available, available >= 0,
 *     and no request got an unexpected status.
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const CAPACITY = Number(process.env.CAPACITY ?? 50);
const REQUESTS = Number(process.env.REQUESTS ?? 400);
const USERS = Number(process.env.USERS ?? 20);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@heritage.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';

async function call(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const admin = await call('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (admin.status !== 200) throw new Error(`Admin login failed: ${JSON.stringify(admin.json)}`);
  const adminToken: string = admin.json.token;

  const sites = (await call('/sites', { token: adminToken })).json.sites;
  const unique = Date.now() % 1000;
  const date = '2030-01-01';
  const startTime = `${String(Math.floor(unique / 60) % 24).padStart(2, '0')}:${String(unique % 60).padStart(2, '0')}`;
  const created = await call('/admin/slots', {
    method: 'POST',
    token: adminToken,
    body: { siteId: sites[0].id, date, startTime, endTime: '23:59', capacity: CAPACITY },
  });
  if (created.status !== 201) throw new Error(`Slot creation failed: ${JSON.stringify(created.json)}`);
  const slotId: string = created.json.slot.id;
  console.log(`Created slot ${slotId} with capacity ${CAPACITY}`);

  const run = Date.now();
  const tokens: string[] = [];
  for (let i = 0; i < USERS; i++) {
    const r = await call('/auth/register', {
      method: 'POST',
      body: { name: `Load ${i}`, email: `load${run}_${i}@test.dev`, password: 'LoadTest@123' },
    });
    if (r.status !== 201) throw new Error(`Register failed: ${JSON.stringify(r.json)}`);
    tokens.push(r.json.token);
  }

  console.log(`Firing ${REQUESTS} simultaneous booking requests...`);
  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) => {
      const quantity = i % 3 === 0 ? 2 : 1;
      return call('/reservations', { method: 'POST', token: tokens[i % USERS], body: { slotId, quantity } }).then((r) => ({
        ...r,
        quantity,
      }));
    }),
  );
  const ms = Math.round(performance.now() - t0);

  const ok = results.filter((r) => r.status === 201);
  const soldOut = results.filter((r) => r.status === 409);
  const other = results.filter((r) => r.status !== 201 && r.status !== 409);
  const granted = ok.reduce((sum, r) => sum + r.quantity, 0);

  const slot = (await call(`/slots/${slotId}`, { token: adminToken })).json.slot;

  console.log(`\nFinished in ${ms} ms`);
  console.log(`  201 booked : ${ok.length} requests (${granted} tickets)`);
  console.log(`  409 refused: ${soldOut.length}`);
  console.log(`  other      : ${other.length}`, other.length ? JSON.stringify(other[0]) : '');
  console.log(`  slot now   : available=${slot.available} booked=${slot.booked} capacity=${slot.capacity}`);

  const checks = [
    ['available never negative', slot.available >= 0],
    ['tickets granted == capacity - available', granted === CAPACITY - slot.available],
    ['no overbooking (granted <= capacity)', granted <= CAPACITY],
    ['no unexpected responses', other.length === 0],
    ['slot fully used (demand exceeded supply)', slot.available === 0 || REQUESTS * 1.33 < CAPACITY],
  ] as const;
  let failed = false;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
