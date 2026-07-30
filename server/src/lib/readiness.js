/**
 * Whether the database side of the boot sequence has finished.
 *
 * The API listens first and migrates second (see server.js), so there is a
 * short window where the process is up but the schema is not confirmed, and a
 * longer one where the database is simply unreachable. `/api/v1/health`
 * publishes which of those it is, because the alternative — dying before the
 * port opens — tells the operator nothing beyond "health check failed".
 *
 * @typedef {'starting'|'ready'|'error'} DbState
 */
let state = /** @type {DbState} */ ('starting');
let detail = null;

export const dbState = () => state;
export const dbDetail = () => detail;

export function markReady() {
  state = 'ready';
  detail = null;
}

export function markFailed(err) {
  state = 'error';
  detail = err?.message ?? String(err);
}
