import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/cairo';
import './index.css';
import './i18n';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The API is now a network hop away — and on a free instance that may be
      // waking from sleep — so cached data is held a little longer than the
      // 15 seconds that made sense against a local database.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error: any) =>
        // Never retry a deliberate client error (validation, 404, business rule).
        (error?.status === undefined || error.status >= 500) && failureCount < 2,
    },
    mutations: { retry: false },
  },
});

/**
 * A tab left open across a deploy is still holding chunk hashes that this
 * build no longer serves (`npm run build` wipes `dist` and renames
 * everything) — the next lazy-loaded route then fails with "Failed to fetch
 * dynamically imported module". Vite fires this event for exactly that case;
 * one reload fetches the current build. Guarded against looping if the
 * network itself is down, and cleared again a few seconds after a clean
 * start so a *later* deploy's preload error can still trigger a reload.
 */
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('reloaded-after-preload-error')) return;
  sessionStorage.setItem('reloaded-after-preload-error', '1');
  window.location.reload();
});
setTimeout(() => sessionStorage.removeItem('reloaded-after-preload-error'), 10_000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
