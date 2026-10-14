import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../hooks/useRealtime';
import type { ReservationEvent, Slot } from '../types';

const todayUtc = () => new Date().toISOString().slice(0, 10);

interface Matrix {
  sites: { id: string; name: string }[];
  slots: Slot[];
}

/** Live capacity matrix: rows = time slots, columns = sites. Cells update the instant a booking commits. */
export default function AdminDashboard() {
  const { token } = useAuth();
  const [date, setDate] = useState(todayUtc());
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [feed, setFeed] = useState<ReservationEvent[]>([]);
  const dateRef = useRef(date);
  dateRef.current = date;

  const load = useCallback(async () => {
    try {
      const r = await api.adminCapacity(date);
      setMatrix({ sites: r.sites, slots: r.slots });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load capacity');
    }
  }, [date]);

  useEffect(() => {
    setMatrix(null);
    void load();
  }, [load]);

  const { connected } = useRealtime(token, {
    onSlotUpdated: (e) => {
      if (e.date !== dateRef.current) return;
      let known = false;
      setMatrix((m) => {
        if (!m) return m;
        return {
          ...m,
          slots: m.slots.map((s) => {
            if (s.id !== e.slotId) return s;
            known = true;
            // Ignore out-of-order (older) pushes.
            return e.version >= s.version
              ? { ...s, available: e.available, booked: e.capacity - e.available, version: e.version }
              : s;
          }),
        };
      });
      setFlash((f) => ({ ...f, [e.slotId]: Date.now() }));
      setTimeout(() => setFlash((f) => (Date.now() - (f[e.slotId] ?? 0) >= 1000 ? omit(f, e.slotId) : f)), 1100);
      // A slot we have never seen (created by an admin) -> refetch the day.
      queueMicrotask(() => !known && void load());
    },
    onReservation: (e) => setFeed((f) => [e, ...f].slice(0, 15)),
  });

  const times = useMemo(
    () => [...new Set(matrix?.slots.map((s) => s.startTime) ?? [])].sort(),
    [matrix],
  );
  const cell = (siteId: string, time: string) => matrix?.slots.find((s) => s.siteId === siteId && s.startTime === time);
  const siteName = (id: string) => matrix?.sites.find((s) => s.id === id)?.name ?? 'Site';

  const totals = useMemo(() => {
    const slots = matrix?.slots ?? [];
    const capacity = slots.reduce((a, s) => a + s.capacity, 0);
    const booked = slots.reduce((a, s) => a + s.booked, 0);
    return { capacity, booked, pct: capacity ? Math.round((booked / capacity) * 100) : 0 };
  }, [matrix]);

  return (
    <div className="stack">
      <section className="card">
        <div className="row between wrap">
          <h2>Live capacity</h2>
          <div className="row gap">
            <span className={`live ${connected ? 'on' : 'off'}`}>{connected ? '● Live' : '○ Reconnecting…'}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          </div>
        </div>
        <p className="muted">
          {totals.booked} of {totals.capacity} tickets booked on {date} ({totals.pct}%)
        </p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {!matrix && !error && <p className="muted">Loading…</p>}

        {matrix && (
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th>Time</th>
                  {matrix.sites.map((s) => (
                    <th key={s.id}>{s.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {times.map((t) => (
                  <tr key={t}>
                    <th scope="row">{t}</th>
                    {matrix.sites.map((s) => {
                      const c = cell(s.id, t);
                      if (!c) return <td key={s.id} className="empty">—</td>;
                      const pct = Math.round((c.booked / c.capacity) * 100);
                      const level = c.available === 0 ? 'full' : pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
                      return (
                        <td key={s.id} className={`cell ${level} ${flash[c.id] ? 'flash' : ''}`}>
                          <div className="cell-top">
                            <strong>{c.booked}</strong>
                            <span className="muted">/ {c.capacity}</span>
                          </div>
                          <div className="bar">
                            <div className="bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="small">{c.available === 0 ? 'SOLD OUT' : `${c.available} left`}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Activity</h3>
        {feed.length === 0 && <p className="muted">Waiting for bookings…</p>}
        <ul className="feed">
          {feed.map((e) => (
            <li key={e.reservationId + e.type + e.at} className={e.type}>
              <span className="badge">{e.type === 'created' ? 'Booked' : 'Cancelled'}</span> {e.quantity} ticket
              {e.quantity > 1 ? 's' : ''} · {siteName(e.siteId)} · <code>{e.bookingRef}</code>
              <span className="muted small"> · {new Date(e.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function omit<T extends Record<string, number>>(obj: T, key: string): T {
  const { [key]: _removed, ...rest } = obj;
  return rest as T;
}
