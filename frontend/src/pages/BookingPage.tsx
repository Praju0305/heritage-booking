import { useCallback, useEffect, useReducer, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../hooks/useRealtime';
import MyReservations from '../components/MyReservations';
import type { Site, Slot } from '../types';

// ---- booking request state machine (idle -> submitting -> success | error) ----
type BookingState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; code: string };

type BookingAction =
  | { type: 'submit' }
  | { type: 'success'; message: string }
  | { type: 'failure'; message: string; code: string }
  | { type: 'reset' };

function bookingReducer(_: BookingState, a: BookingAction): BookingState {
  switch (a.type) {
    case 'submit':
      return { status: 'submitting' };
    case 'success':
      return { status: 'success', message: a.message };
    case 'failure':
      return { status: 'error', message: a.message, code: a.code };
    case 'reset':
      return { status: 'idle' };
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

export default function BookingPage() {
  const { token } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [date, setDate] = useState(todayUtc());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotId, setSlotId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [booking, dispatch] = useReducer(bookingReducer, { status: 'idle' });
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load sites once.
  useEffect(() => {
    api
      .sites()
      .then((r) => {
        setSites(r.sites);
        if (r.sites[0]) setSiteId(r.sites[0].id);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load sites'));
  }, []);

  const loadSlots = useCallback(async () => {
    if (!siteId || !date) return;
    setSlotsLoading(true);
    try {
      setSlots((await api.slots(siteId, date)).slots);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not load time slots');
    } finally {
      setSlotsLoading(false);
    }
  }, [siteId, date]);

  useEffect(() => {
    setSlotId('');
    setLiveNotice(null);
    dispatch({ type: 'reset' });
    void loadSlots();
  }, [loadSlots]);

  // Live availability: patch the matching slot the instant the server commits a change.
  useRealtime(token, {
    onSlotUpdated: (e) => {
      if (e.siteId !== siteId || e.date !== date) return;
      setSlots((prev) =>
        prev.map((s) =>
          s.id === e.slotId && e.version >= s.version
            ? { ...s, available: e.available, booked: e.capacity - e.available, version: e.version }
            : s,
        ),
      );
      if (e.slotId === slotId && e.available < quantity) {
        setLiveNotice(
          e.available === 0
            ? 'This time slot just sold out. Please pick another.'
            : `Only ${e.available} ticket(s) left for this slot — reduce your quantity.`,
        );
        if (e.available > 0) setQuantity(e.available);
      }
    },
  });

  const selected = slots.find((s) => s.id === slotId);
  const maxQty = selected ? Math.max(1, Math.min(10, selected.available)) : 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || booking.status === 'submitting') return;
    dispatch({ type: 'submit' });
    try {
      // Idempotency key: a retried/double-sent request can never create two reservations.
      const key = crypto.randomUUID();
      const r = await api.book(selected.id, quantity, key);
      dispatch({ type: 'success', message: `Booked! Your reference is ${r.reservation.bookingRef}.` });
      setLiveNotice(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      dispatch({
        type: 'failure',
        message: apiErr?.message ?? 'Booking failed. Please try again.',
        code: apiErr?.code ?? 'UNKNOWN',
      });
      // Sold out / closed while the user was deciding: refresh the real numbers.
      if (apiErr?.code === 'SOLD_OUT' || apiErr?.code === 'SLOT_CLOSED') {
        setSlotId('');
        void loadSlots();
      }
    }
  }

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Book tickets</h2>
        {loadError && <div className="alert alert-error" role="alert">{loadError}</div>}

        <form onSubmit={submit} className="stack">
          <label>
            Site
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" value={date} min={todayUtc()} onChange={(e) => setDate(e.target.value)} required />
          </label>

          <fieldset>
            <legend>Time slot {slotsLoading && <span className="muted small">· updating…</span>}</legend>
            {slots.length === 0 && !slotsLoading && <p className="muted">No slots for this date.</p>}
            <div className="slot-grid">
              {slots.map((s) => {
                const soldOut = s.available === 0 || s.status !== 'open';
                const low = !soldOut && s.available <= Math.ceil(s.capacity * 0.1);
                return (
                  <button
                    type="button"
                    key={s.id}
                    disabled={soldOut}
                    className={`slot ${s.id === slotId ? 'selected' : ''} ${soldOut ? 'soldout' : ''}`}
                    onClick={() => {
                      setSlotId(s.id);
                      setQuantity((q) => Math.min(q, Math.max(1, s.available)));
                      setLiveNotice(null);
                      dispatch({ type: 'reset' });
                    }}
                  >
                    <span className="slot-time">{s.startTime}</span>
                    <span className={`slot-left ${low ? 'low' : ''}`}>{soldOut ? 'Sold out' : `${s.available} left`}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label>
            Tickets
            <input
              type="number"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))}
              disabled={!selected}
            />
          </label>

          {liveNotice && <div className="alert alert-warn" role="status">{liveNotice}</div>}
          {booking.status === 'error' && <div className="alert alert-error" role="alert">{booking.message}</div>}
          {booking.status === 'success' && <div className="alert alert-ok" role="status">{booking.message}</div>}

          <button className="btn primary" disabled={!selected || booking.status === 'submitting'}>
            {booking.status === 'submitting' ? 'Reserving…' : 'Reserve tickets'}
          </button>
        </form>
      </section>

      <MyReservations refreshKey={refreshKey} />
    </div>
  );
}
