export type Role = 'user' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Site {
  id: string;
  name: string;
  slug: string;
  description: string;
  location: string;
}

export interface Slot {
  id: string;
  siteId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  available: number;
  booked: number;
  status: 'open' | 'closed';
  version: number;
}

/** Pushed over the socket after every committed booking/cancellation. */
export interface SlotUpdatedEvent {
  slotId: string;
  siteId: string;
  date: string;
  startTime: string;
  capacity: number;
  available: number;
  version: number;
}

export interface ReservationEvent {
  type: 'created' | 'cancelled';
  reservationId: string;
  bookingRef: string;
  slotId: string;
  siteId: string;
  quantity: number;
  at: string;
}

export interface MyReservation {
  id: string;
  bookingRef: string;
  quantity: number;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
  site: { id: string; name: string } | null;
  slot: { id: string; date: string; startTime: string; endTime: string } | null;
}
