import { lazy, Suspense, useEffect } from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Shell } from '@/components/layout/Shell';
import { useSession } from '@/lib/session';

/**
 * Routes are code-split so the first paint is fast.
 *
 * Hash routing is kept deliberately: the frontend is served as a static bundle
 * from Vercel, and `#/items/…` deep links resolve without any server-side
 * rewrite rules.
 *
 * This is the *data* router (`createHashRouter`) rather than the `<HashRouter>`
 * component, because `useBlocker` — which guards an unposted invoice against
 * being navigated away from — is only available on a data router.
 */
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Items = lazy(() => import('@/pages/Items'));
const ItemDetail = lazy(() => import('@/pages/ItemDetail'));
const Categories = lazy(() => import('@/pages/Categories'));
const Movements = lazy(() => import('@/pages/Movements'));
const Invoices = lazy(() => import('@/pages/Invoices'));
const InvoiceForm = lazy(() => import('@/pages/InvoiceForm'));
const InvoiceDetail = lazy(() => import('@/pages/InvoiceDetail'));
const StockCounts = lazy(() => import('@/pages/StockCounts'));
const StockCountDetail = lazy(() => import('@/pages/StockCountDetail'));
const ImportItems = lazy(() => import('@/pages/ImportItems'));
const Parties = lazy(() => import('@/pages/Parties'));
const LowStock = lazy(() => import('@/pages/LowStock'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const Login = lazy(() => import('@/pages/Login'));

const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'items', element: <Items /> },
      { path: 'items/:id', element: <ItemDetail /> },
      { path: 'categories', element: <Categories /> },
      { path: 'movements', element: <Movements /> },
      { path: 'invoices', element: <Invoices /> },
      { path: 'invoices/new', element: <InvoiceForm /> },
      { path: 'invoices/:id', element: <InvoiceDetail /> },
      { path: 'invoices/:id/edit', element: <InvoiceForm /> },
      { path: 'stock-counts', element: <StockCounts /> },
      { path: 'stock-counts/:id', element: <StockCountDetail /> },
      { path: 'import', element: <ImportItems /> },
      { path: 'customers', element: <Parties kind="customers" /> },
      { path: 'suppliers', element: <Parties kind="suppliers" /> },
      { path: 'reports/low-stock', element: <LowStock /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-surface-2">
      <Loader2 className="size-6 animate-spin text-brand-500" />
    </div>
  );
}

export function App() {
  const status = useSession((s) => s.status);
  const queryClient = useQueryClient();

  // One user's cached data must never be visible to whoever signs in next.
  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status, queryClient]);

  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') {
    return (
      <Suspense fallback={<Splash />}>
        <Login />
      </Suspense>
    );
  }
  return <RouterProvider router={router} />;
}
