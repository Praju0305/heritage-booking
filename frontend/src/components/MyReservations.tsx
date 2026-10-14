import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { MyReservation } from '../types';

/** The signed-in user's own reservations, with cancel. `refreshKey` bumps after a new booking. */
export default function MyReservations({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<MyReservation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.mine()).reservations);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reservations');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function cancel(id: string) {
    if (!window.confirm('Cancel this reservation? The tickets will be released.')) return;
    setCancelling(id);
    try {
      await api.cancel(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancellation failed');
    } finally {
      setCancelling(null);
    }
  }

  return (
    <section className="card">
      <h2>My reservations</h2>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted">No reservations yet.</p>}
      <ul className="res-list">
        {items?.map((r) => (
          <li key={r.id} className={r.status === 'cancelled' ? 'res cancelled' : 'res'}>
            <div>
              <strong>{r.site?.name ?? 'Site'}</strong>
              <div className="muted small">
                {r.slot ? `${r.slot.date} · ${r.slot.startTime}–${r.slot.endTime}` : ''} · {r.quantity} ticket
                {r.quantity > 1 ? 's' : ''} · <code>{r.bookingRef}</code>
              </div>
            </div>
            {r.status === 'confirmed' ? (
              <button className="btn danger" disabled={cancelling === r.id} onClick={() => cancel(r.id)}>
                {cancelling === r.id ? 'Cancelling…' : 'Cancel'}
              </button>
            ) : (
              <span className="badge">Cancelled</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
