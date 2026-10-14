import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ReservationEvent, SlotUpdatedEvent } from '../types';

interface Handlers {
  onSlotUpdated?: (e: SlotUpdatedEvent) => void;
  onReservation?: (e: ReservationEvent) => void;
}

/**
 * Opens one authenticated Socket.io connection while `token` is set and
 * forwards server pushes to the latest handlers (kept in a ref so handler
 * identity changes never cause reconnects).
 */
export function useRealtime(token: string | null, handlers: Handlers): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('slot:updated', (e: SlotUpdatedEvent) => ref.current.onSlotUpdated?.(e));
    socket.on('reservation:event', (e: ReservationEvent) => ref.current.onReservation?.(e));
    return () => {
      socket.close();
      setConnected(false);
    };
  }, [token]);

  return { connected };
}
