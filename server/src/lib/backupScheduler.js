/**
 * The automatic backup.
 *
 * Windows already has a scheduler, and `deploy/windows/backup.ps1` registered
 * as a 02:00 task is still the sturdier arrangement — it runs whether or not
 * the API process is alive. This exists because it can be turned on from the
 * screen, by the person who owns the data, without an administrator, a
 * PowerShell prompt or a second machine. Both write into the same folder in
 * the same format, so turning one on does not invalidate the other; the only
 * thing to avoid is scheduling both at the same minute, and the UI says so.
 *
 * ---------------------------------------------------------------------------
 * Why there is no "last run" file
 * ---------------------------------------------------------------------------
 * The question "has today's backup been taken?" already has an answer on disk:
 * the newest set. Deriving it from there rather than from a state file means a
 * restart cannot lose the answer, a restore cannot rewrite it, and the two
 * can never disagree — which is exactly the failure mode where a scheduler
 * believes it ran and no backup exists.
 *
 * It also gives the right behaviour for free in both directions: a manual
 * backup after the scheduled time counts as today's, and a machine that was
 * switched off at 02:00 takes its backup as soon as it is switched on, rather
 * than skipping the day.
 */
import { createSet, listSets, readConfig, copySetTo, pruneSets } from './backup.js';

/** Checked every minute — cheap, and it means a schedule change takes effect at once. */
const TICK_MS = 60_000;

let timer = null;
let running = false;
let lastRun = null;

/** What the last automatic run did, for the status line on the backup screen. */
export const lastAutoRun = () => lastRun;

/** Today's (or, once past, tomorrow's) scheduled moment, in local time. */
export function nextRunAt(config, from = new Date()) {
  const [hours, minutes] = String(config.time ?? '02:00').split(':').map(Number);
  const due = new Date(from);
  due.setHours(hours || 0, minutes || 0, 0, 0);
  if (due <= from) due.setDate(due.getDate() + 1);
  return due;
}

/** The moment today's backup was due — the cut-off `alreadyRan` compares against. */
function dueToday(config, now) {
  const [hours, minutes] = String(config.time ?? '02:00').split(':').map(Number);
  const due = new Date(now);
  due.setHours(hours || 0, minutes || 0, 0, 0);
  return due;
}

/** Parse a set name (`2026-08-16_0200`) back into a local Date. */
function setTime(name) {
  const [date, time] = name.split('_');
  return new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00`);
}

/**
 * One decision: is a backup due right now, and if so take it.
 *
 * Exported because it is the whole of the scheduler worth testing, and a
 * once-a-minute timer is a bad place to find out that the answer is wrong.
 * Returns why it did nothing, which is what the tests assert on.
 */
export async function runIfDue(now = new Date()) {
  if (running) return 'busy';

  const config = await readConfig().catch(() => null);
  if (!config?.auto) return 'disabled';

  const due = dueToday(config, now);
  if (now < due) return 'not-due';

  const sets = await listSets().catch(() => []);
  // Any set — manual, automatic or pulled — newer than today's scheduled
  // moment means today is covered.
  if (sets.some((s) => setTime(s.name) >= due)) return 'already-done';

  running = true;
  try {
    const set = await createSet({ source: 'auto' });
    lastRun = { at: new Date().toISOString(), ok: true, set: set.name, copied_to: null, error: null };
    console.log(`[backup] automatic backup ${set.name} (${Math.round(set.size / 1024 / 1024)} MB)`);

    if (config.copy_to) {
      try {
        lastRun.copied_to = await copySetTo(set.name, config.copy_to);
        console.log(`[backup] copied to ${lastRun.copied_to}`);
      } catch (err) {
        // Not fatal: a standby that is switched off tonight must not cost the
        // local backup as well. Recorded so the screen can show it went stale.
        lastRun.copy_error = err.message;
        console.error(`[backup] copy to ${config.copy_to} failed: ${err.message}`);
      }
    }

    const pruned = await pruneSets(config.keep_days).catch(() => []);
    if (pruned.length) console.log(`[backup] pruned ${pruned.length} old set(s)`);
    return 'backed-up';
  } catch (err) {
    lastRun = { at: new Date().toISOString(), ok: false, set: null, error: err.message };
    console.error(`[backup] automatic backup failed: ${err.message}`);
    return 'failed';
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (timer) return;
  // Not immediately: boot is the busiest minute this process has, and a
  // missed backup can wait one more.
  timer = setInterval(() => { runIfDue().catch(() => {}); }, TICK_MS);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
