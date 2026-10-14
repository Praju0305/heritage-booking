import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import api from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind nginx in docker-compose
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin / curl requests have no Origin header.
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error('Origin not allowed'));
      },
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
