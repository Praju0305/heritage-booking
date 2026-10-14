import type { MyReservation, Site, Slot, User } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'hb_token';
export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, init: RequestInit & { json?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  register: (b: { name: string; email: string; password: string }) =>
    request<{ token: string; user: User }>('/auth/register', { method: 'POST', json: b }),
  login: (b: { email: string; password: string }) =>
    request<{ token: string; user: User }>('/auth/login', { method: 'POST', json: b }),
  me: () => request<{ user: User }>('/auth/me'),
  sites: () => request<{ sites: Site[] }>('/sites'),
  slots: (siteId: string, date: string) => request<{ slots: Slot[] }>(`/sites/${siteId}/slots?date=${date}`),
  book: (slotId: string, quantity: number, idempotencyKey: string) =>
    request<{ reservation: { id: string; bookingRef: string }; availableTickets?: number }>('/reservations', {
      method: 'POST',
      json: { slotId, quantity },
      idempotencyKey,
    }),
  cancel: (id: string) => request<{ reservation: { id: string } }>(`/reservations/${id}`, { method: 'DELETE' }),
  mine: () => request<{ reservations: MyReservation[] }>('/reservations/mine'),
  adminCapacity: (date: string) =>
    request<{ date: string; sites: { id: string; name: string }[]; slots: Slot[] }>(`/admin/capacity?date=${date}`),
};
