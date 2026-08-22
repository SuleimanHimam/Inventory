import express from 'express';
import cors from 'cors';

import { errorHandler } from './lib/http.js';
import {
  authenticate, orgContext, AUTH_MODE, AUTH_DISABLED, authConfigError,
} from './lib/auth.js';
import { STORAGE_DRIVER, UPLOADS_DIR, publicUrl, storageConfigError } from './lib/storage.js';
import { dbState, dbDetail } from './lib/readiness.js';
import itemsRoutes from './routes/items.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import invoicesRoutes from './routes/invoices.routes.js';
import stockCountsRoutes from './routes/stockCounts.routes.js';
import importRoutes from './routes/importItems.routes.js';
import metaRoutes from './routes/meta.routes.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import backupRoutes from './routes/backup.routes.js';
import { partiesRouter } from './routes/parties.routes.js';
import { redactMoney, stripMoneyFromBody, requireManager } from './lib/roles.js';

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
  //
  // `ok` answers "is this process serving?", which is the question the platform
  // is really asking, so a database problem does not fail the deploy and hide
  // itself behind a restart loop. `db` is where that problem is named.
  app.get('/api/v1/health', (_req, res) => res.json({
    ok: true,
    version: '6.0.0',
    auth: AUTH_MODE,
    storage: STORAGE_DRIVER,
    db: dbState(),
    ...(dbDetail() ? { dbError: dbDetail() } : {}),
    ...(authConfigError ? { authError: authConfigError } : {}),
    ...(storageConfigError ? { storageError: storageConfigError } : {}),
    // Deliberately visible: an open API should be obvious from the outside.
    ...(AUTH_DISABLED ? { insecure: true } : {}),
  }));

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

  // Register/login have to work before there is a token to check, so this is
  // mounted ahead of the `authenticate` gate below. It guards itself: every
  // handler 503s unless AUTH_MODE=local (see auth.routes.js).
  api.use('/auth', authRoutes);

  // Everything below this line requires a verified token.
  api.use(authenticate);

  /*
   * Backup and restore sit between the two halves of the auth chain on
   * purpose. `orgContext` opens one transaction on the inventory database and
   * holds it open for the whole request — and a restore evicts every session
   * on that database, which would include the one serving the request. So
   * these handlers get `req.auth` (hence `requireManager`) but no ambient
   * transaction; they reach SQL Server through their own `master`-bound pool.
   * See lib/backup.js.
   */
  api.use('/backup', requireManager, backupRoutes);

  // Everything below this line additionally runs inside its organisation's
  // database context.
  api.use(orgContext);

  /*
   * Role filters, mounted here rather than per-route on purpose: everything
   * below is covered, including routes added later. `redactMoney` strips prices
   * from responses for a role that may not see them; `stripMoneyFromBody` drops
   * them from requests, so the same role cannot set what it cannot read. See
   * lib/roles.js for why this is a filter and not a second column list.
   */
  api.use(redactMoney, stripMoneyFromBody);

  api.use('/users', usersRoutes);

  // Bulk import both reads and writes prices — its Excel template has the two
  // price columns in it — so it belongs to the role that is allowed to see them.
  // Mounted before `/items` so `/items/import/*` is not captured by `/items/:id`.
  api.use('/items/import', requireManager, importRoutes);
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
