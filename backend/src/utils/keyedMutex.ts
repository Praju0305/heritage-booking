/**
 * Per-key async mutex (promise chain).
 *
 * Booking requests for the SAME time slot are serialised inside one Node
 * process, so hundreds of simultaneous requests form an orderly queue instead
 * of all colliding in MongoDB and aborting with write conflicts. Requests for
 * different slots still run fully in parallel.
 *
 * IMPORTANT: this is a throughput optimisation, not the correctness guarantee.
 * Correctness comes from the atomic conditional update inside a MongoDB ACID
 * transaction (see booking.service.ts), which stays safe even with several API
 * replicas where this in-process lock cannot coordinate.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Chain after the previous task regardless of whether it succeeded.
    const next = prev.catch(() => undefined).then(task);
    this.tails.set(key, next);
    try {
      return await next;
    } finally {
      // Drop the entry once we are the tail so the map does not grow forever.
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }

  get size(): number {
    return this.tails.size;
  }
}
