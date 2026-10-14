import http from 'node:http';
import mongoose from 'mongoose';
import { config } from './config';
import { connectDb } from './db';
import { createApp } from './app';
import { attachSocket } from './socket';
import { seed } from './seed/seed';

async function main() {
  await connectDb();
  if (config.SEED_ON_START) await seed({ onlyIfEmpty: true });

  const server = http.createServer(createApp());
  attachSocket(server);
  server.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on :${config.PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
