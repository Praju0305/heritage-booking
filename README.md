# Heritage Booking: Reservation Concurrency Challenge

Concurrency-safe ticket reservation platform for heritage sites: **React + Node/Express + MongoDB (ACID transactions) + Socket.io**, all started with one command.

## Quick start

```bash
docker compose up --build
```

| Service  | URL                    |
|----------|------------------------|
| Web app  | http://localhost:8080  |
| API      | http://localhost:8080/api (through frontend proxy) |
| MongoDB  | `mongo:27017` (internal Docker network, replica set `rs0`) |


Seed data (4 Karnataka heritage sites × 7 days × 8 hourly slots) loads automatically on first start.

| Role    | E-mail                  | Password        |
|---------|-------------------------|-----------------|
| Admin   | `admin@heritage.test`   | `Admin@12345`   |
| Visitor | `visitor@heritage.test` | `Visitor@12345` |

Set your own `JWT_SECRET` (32+ chars) before any real deployment: `JWT_SECRET=... docker compose up --build`.

### Prove it doesn't overbook

With the stack running:

```bash
cd backend && npm install
npm run load-test                         # 400 simultaneous requests vs. a 50-ticket slot
CAPACITY=100 REQUESTS=1000 USERS=40 API_URL=http://localhost:8080 npm run load-test
```

The script creates a fresh slot, fires all requests at the same instant, then reconciles: tickets granted == `capacity − available`, `available >= 0`, no unexpected responses. Exit code is non-zero on any violation.

`npm run check:offline` (no database needed) verifies JWT forgery rejection (`alg:none`, wrong secret/audience/algorithm, expiry, tampered payload) and the per-slot queue ordering.

### Local development (without Docker)

```bash
# MongoDB must run as a replica set for transactions:  mongod --replSet rs0   then   mongosh --eval "rs.initiate()"
cd backend  && cp .env.example .env && npm install && npm run dev     # API on :4000
cd frontend && npm install && npm run dev                              # UI on :5173 (proxies /api and /socket.io)
```

## Architecture

```
React (Vite, nginx)  ──REST──▶  Express routes → controllers → services ──▶ MongoDB (replica set, ACID txns)
        ▲                                   │ after COMMIT
        └────── Socket.io (JWT-authed) ◀────┘  domain events (slot:updated, reservation:event)
```

- **backend/src/routes**: URL → middleware chain wiring (auth, validation, rate limits)
- **controllers**: HTTP translation only (parse input, shape output)
- **services**: business logic (`booking.service.ts` is the heart), no Express types
- **models**: Mongoose schemas and indexes; **middleware**: auth, validation, error handling
- **socket.ts**: authenticated real-time push, fed by an internal event bus so services never import transport code

### Schemas (MongoDB)
- `User`: unique e-mail, bcrypt hash (`select:false`), `role` (never writable via API)
- `Site`: unique slug, daily capacity, active flag
- `TimeSlot`: `site, date, startTime, startsAt, capacity, availableTickets, status, version`. Unique index `(site, date, startTime)`; secondary index `(date, startTime)` serves the admin matrix in one query
- `Reservation`: `bookingRef, user, slot, site, quantity, status, idempotencyKey`. Indexes `(user, createdAt)`, `(slot, status)`, and a partial unique `(user, idempotencyKey)`

## Concurrency strategy (System Integrity)

Three independent layers; the first two guarantee correctness, the third protects performance and the last line of defence.

1. **Atomic compare-and-set inside an ACID transaction** (`booking.service.ts`).
   Booking never reads availability and then writes. One `findOneAndUpdate` carries the check *and* the decrement:
   ```
   filter: { _id, status:'open', startsAt > now, availableTickets >= qty }
   update: { $inc: { availableTickets: -qty, version: 1 } }
   ```
   MongoDB executes this under a document-level lock, so of N simultaneous requests only those that still fit match; the rest match nothing and receive a clean `409 SOLD_OUT`. The decrement and the `Reservation` insert commit together in one multi-document transaction (`snapshot` read concern, `majority` write concern); `withTransaction` automatically retries `TransientTransactionError` write conflicts.
2. **Optimistic-concurrency `version`** is incremented on every inventory change; clients and the dashboard use it to ignore out-of-order real-time pushes.
3. **Per-slot in-process queue** (`KeyedMutex`): requests for the *same* slot are processed one at a time per API process, so hundreds of simultaneous requests form an orderly queue instead of all colliding and retrying in MongoDB. Different slots run in parallel. This is a throughput optimisation: correctness does not depend on it, so multiple API replicas remain safe (a BullMQ/Redis queue would be the next step for cross-replica queuing).
4. **Database guard rail**: a collection-level `$jsonSchema` validator rejects any write that makes `availableTickets < 0` or `> capacity`, even if a future code path forgets layer 1.

Cancellation flips `confirmed → cancelled` atomically (at most once) and releases tickets in the same transaction, so double-clicks or retries cannot release tickets twice. Booking supports an `Idempotency-Key` header (the UI sends one per click) so a retried POST can never create two reservations.

### Real-time
Events are published **only after the transaction commits**. All authenticated sockets receive `slot:updated` (live availability on the booking page); only DB-verified admins join the `admins` room and receive `reservation:event` (activity feed). The admin matrix flashes the changed cell and updates counts instantly with no refresh.

## Security remediation

| # | Vulnerability | Fix |
|---|---------------|-----|
| 1 | **Race conditions / TOCTOU** | No check-then-act window: availability check and decrement are one atomic conditional update inside a transaction (see above), backed by a DB-level validator. Proven by `npm run load-test`. |
| 2 | **IDOR on cancel** | The authenticated user id comes from the verified token and is **part of the query filter** (`{_id, user: me, status:'confirmed'}`), not a fetch-then-compare step. Someone else's reservation id simply matches nothing → `404` (not `403`, so ids can't be probed). The user id is never read from the request body/params. Only admins (role loaded from the DB) may cancel others'. |
| 3 | **JWT tampering / privilege escalation** | Tokens are HS256-signed; verification pins `algorithms:['HS256']` (defeats `alg:none` and algorithm confusion) and checks issuer, audience and expiry (1 h). The server **re-reads the user and role from MongoDB on every request** and every socket handshake, so a forged or stale `role` claim grants nothing. Registration schema is `.strict()`, so `role:"admin"` in a signup payload is rejected with 400. Admin routes use `requireRole('admin')`; the admin socket room is joined only for DB-verified admins. The app refuses to start with a JWT secret under 32 chars. |

Additional hardening: Zod `.strict()` validation on every input (also blocks NoSQL operator injection like `{"$ne":null}`), `helmet`, CORS allow-list, 10 kb body limit, rate limiting on login/register, constant-time-ish login (dummy hash for unknown e-mails), no stack traces in error responses.

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register`, `/api/auth/login` | none | Obtain JWT |
| GET | `/api/auth/me` | user | Current identity |
| GET | `/api/sites` | user | List sites |
| GET | `/api/sites/:id/slots?date=YYYY-MM-DD` | user | Slot availability |
| GET | `/api/slots/:id` | user | Single slot capacity |
| POST | `/api/reservations` `{slotId, quantity}` | user | Book (optional `Idempotency-Key` header) |
| GET | `/api/reservations/mine` | user | Own reservations |
| DELETE | `/api/reservations/:id` | owner/admin | Cancel |
| GET | `/api/admin/capacity?date=` | admin | Full capacity matrix |
| POST | `/api/admin/slots` | admin | Create a slot |

Error bodies: `{ "error": { "code": "SOLD_OUT", "message": "…" } }`.

## Trade-offs and next steps
- Slot times are stored as UTC; a production system would store each site's time zone.
- The JWT lives in `sessionStorage` (simple, survives refresh, cleared on tab close); an httpOnly cookie plus CSRF protection would be the stricter option.
- For multi-replica queuing, replace `KeyedMutex` with a BullMQ queue partitioned by slot id; correctness would not change.
