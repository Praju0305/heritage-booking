import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config';
import { authenticate } from './services/auth.service';
import { domainEvents, ReservationEvent, SlotUpdatedEvent } from './utils/events';

/**
 * Real-time push over Socket.io.
 *  - Every socket must present a valid JWT in the handshake (same checks as REST).
 *  - All authenticated users join "users" and get live slot availability.
 *  - Only DB-verified admins join "admins" and receive the reservation activity feed.
 * Events are emitted only after the DB transaction has committed.
 */
export function attachSocket(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: config.corsOrigins },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('unauthorized'));
      socket.data.user = await authenticate(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('users');
    if (socket.data.user.role === 'admin') socket.join('admins');
  });

  domainEvents.on('slot:updated', (e: SlotUpdatedEvent) => io.to('users').emit('slot:updated', e));
  domainEvents.on('reservation:event', (e: ReservationEvent) => io.to('admins').emit('reservation:event', e));

  return io;
}
