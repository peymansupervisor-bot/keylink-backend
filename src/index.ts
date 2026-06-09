import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRouter from './routes/auth';
import listingsRouter from './routes/listings';
import aiRouter from './routes/ai';
import messagesRouter from './routes/messages';
import placesRouter from './routes/places';
import notificationsRouter from './routes/notifications';
import applicationsRouter from './routes/applications';
import { initChatServer } from './services/chat';

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT ?? 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Global rate limit ─────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/listings', listingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/places', placesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/applications', applicationsRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
});

// ── WebSocket chat server ─────────────────────────────────────────────────────
initChatServer(httpServer, CLIENT_ORIGIN);

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🏠 RentalDom API running on port ${PORT}`);
  console.log(`   REST:      http://localhost:${PORT}/api`);
  console.log(`   WebSocket: ws://localhost:${PORT}/chat`);
  console.log(`   Health:    http://localhost:${PORT}/health\n`);
});
