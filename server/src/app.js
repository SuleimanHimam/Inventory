import express from 'express';
import cors from 'cors';

import { errorHandler } from './lib/http.js';
import { authenticate, orgContext, AUTH_MODE } from './lib/auth.js';
import { STORAGE_DRIVER, UPLOADS_DIR, publicUrl } from './lib/storage.js';
import itemsRoutes from './routes/items.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import invoicesRoutes from './routes/invoices.routes.js';
import stockCountsRoutes from './routes/stockCounts.routes.js';
import importRoutes from './routes/importItems.routes.js';
import metaRoutes from './routes/meta.routes.js';
import { partiesRouter } from './routes/parties.routes.js';

/**
 * Allowed browser origins. A hosted API must not answer `*`: the frontend is a
 * known Vercel deployment, so only that origin (plus whatever localhost the
 * developer runs) may call it. Comma-separated, and `CORS_ORIGIN_REGEX` covers
 * Vercel's per-commit preview URLs when they are wanted.
 */
function corsOptions() {
  const allowed = (process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const pattern = process.env.CORS_ORIGIN_REGEX ? new RegExp(process.env.CORS_ORIGIN_REGEX) : null;

  return {
    origin(origin, callback) {
      // No Origin header: curl, health checks, server-to-server. Not a browser,
      // so the same-origin policy is not what is protecting anything here.
      if (!origin) return callback(null, true);
      const clean = origin.replace(/\/$/, '');
      // An unknown origin gets no Access-Control-Allow-Origin header, and the
      // browser refuses to hand the response to the page. Answering with an
      // error instead would only turn every stray request into a 500 in the
      // logs. Nothing here relies on cookies, so there is no CSRF surface to
      // protect beyond that.
      return callback(null, allowed.includes(clean) || !!pattern?.test(clean));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  };
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Railway terminates TLS in front of the app; trust its forwarding headers so
  // req.protocol and rate-limiting by IP see the real client.
  app.set('trust proxy', 1);
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '2mb' }));

  // Liveness probe — public, and deliberately outside the auth chain so a
  // platform health check never depends on a token.
  app.get('/api/v1/health', (_req, res) =>
    res.json({ ok: true, version: '6.0.0', auth: AUTH_MODE, storage: STORAGE_DRIVER }));

  /**
   * Product photos. Served outside /api and without auth: filenames are random
   * UUIDs, and an <img> tag cannot send an Authorization header. On the hosted
   * deployment the bytes live in Supabase Storage, so the same URL redirects
   * there — which keeps `image_url` in every API response unchanged.
   */
  if (STORAGE_DRIVER === 'local') {
    app.use('/uploads', express.static(UPLOADS_DIR, {
      maxAge: '30d',
      immutable: true,
      index: false,
      fallthrough: false,
    }));
  } else {
    app.get('/uploads/:file', (req, res) => res.redirect(302, publicUrl(req.params.file)));
  }

  const api = express.Router();

  // Everything below this line requires a verified token and runs inside its
  // organisation's database context.
  api.use(authenticate, orgContext);

  // Mounted before `/items` so `/items/import/*` is not captured by `/items/:id`.
  api.use('/items/import', importRoutes);
  api.use('/items', itemsRoutes);
  api.use('/categories', categoriesRoutes);
  api.use('/customers', partiesRouter('customers'));
  api.use('/suppliers', partiesRouter('suppliers'));
  api.use('/invoices', invoicesRoutes);
  api.use('/stock-counts', stockCountsRoutes);
  api.use('/', metaRoutes);

  app.use('/api/v1', api);

  app.use('/api', (_req, res) =>
    res.status(404).json({ error: 'المسار غير موجود', code: 'NOT_FOUND' }));
  app.use(errorHandler);

  return app;
}
