/**
 * Wraps the browser's native PWA install flow (the `beforeinstallprompt` /
 * `appinstalled` events). Chromium browsers fire `beforeinstallprompt` only
 * when the manifest + icons criteria are met AND the page is a secure
 * context — HTTPS, or specifically http://localhost / http://127.0.0.1.
 * Over plain http:// on a LAN or public IP (this deployment, absent a
 * domain + TLS), the event never fires and `canInstall` stays false — that
 * is a browser security rule, not a bug here.
 *
 * Using the native prompt (rather than generating a downloadable file)
 * is what makes the installed icon open as a real standalone/fullscreen
 * window per the manifest, on both Windows and Android.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let installed = matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: fullscreen)').matches;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  installed = true;
  notify();
});

export function subscribeInstallPrompt(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCanInstall() {
  return deferred !== null && !installed;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const event = deferred;
  deferred = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
