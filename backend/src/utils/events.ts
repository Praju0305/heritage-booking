import { EventEmitter } from 'node:events';

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

/**
 * Domain event bus. Services publish AFTER their transaction has committed;
 * the socket layer subscribes. Keeps services free of transport concerns.
 */
export const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(50);

export const publishSlotUpdated = (e: SlotUpdatedEvent) => domainEvents.emit('slot:updated', e);
export const publishReservation = (e: ReservationEvent) => domainEvents.emit('reservation:event', e);
