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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
