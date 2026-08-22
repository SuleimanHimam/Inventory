import { lazy, Suspense, useEffect } from 'react';
import {
  createHashRouter, RouterProvider, Navigate, Outlet, useLocation, type Location,
} from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Shell } from '@/components/layout/Shell';
import { RequireManager } from '@/components/RequireManager';
import { RequireNotClerk } from '@/components/RequireNotClerk';
import { Toaster } from '@/components/ui/Toaster';
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
const UsersPage = lazy(() => import('@/pages/Users'));
const BackupPage = lazy(() => import('@/pages/Backup'));
const Login = lazy(() => import('@/pages/Login'));
// Not lazy: an error screen that has to fetch a chunk before it can render is
// exactly the screen that fails when chunk loading is what broke.
import { NotFound, RouteError } from '@/pages/ErrorPage';

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface-2">
      <Loader2 className="size-6 animate-spin text-brand-500" />
    </div>
  );
}

/**
 * Guards every route below it: signed out visitors are bounced to `/login`,
 * carrying the location they actually asked for so the login route can send
 * them back to it afterwards instead of always landing on the dashboard.
 */
function RequireAuth() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status !== 'signedIn') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** The inverse guard on `/login` itself: an already-signed-in visitor has no reason to see it. */
function PublicOnly() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'signedIn') {
    const from = (location.state as { from?: Location } | null)?.from;
    const to = from ? `${from.pathname}${from.search}${from.hash}` : '/';
    return <Navigate to={to} replace />;
  }
  return <Outlet />;
}

const router = createHashRouter([
  {
    element: <PublicOnly />,
    errorElement: <RouteError />,
    children: [
      { path: 'login', element: <Suspense fallback={<Splash />}><Login /></Suspense> },
    ],
  },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Shell />,
        children: [
          { index: true, element: <RequireNotClerk><Dashboard /></RequireNotClerk> },
          { path: 'items', element: <Items /> },
          { path: 'items/:id', element: <ItemDetail /> },
          { path: 'categories', element: <Categories /> },
          { path: 'movements', element: <Movements /> },
          // Manager and staff browse and search every invoice here; a clerk
          // is refused both client- and API-side — see RequireNotClerk.
          { path: 'invoices', element: <RequireNotClerk><Invoices /></RequireNotClerk> },
          { path: 'invoices/new', element: <InvoiceForm /> },
          { path: 'invoices/:id', element: <InvoiceDetail /> },
          { path: 'invoices/:id/edit', element: <InvoiceForm /> },
          { path: 'stock-counts', element: <StockCounts /> },
          { path: 'stock-counts/:id', element: <StockCountDetail /> },
          // Manager-only, and guarded here as well as on the API: reaching it
          // by URL should explain itself, not 403 one request at a time.
          { path: 'import', element: <RequireManager><ImportItems /></RequireManager> },
          { path: 'customers', element: <Parties kind="customers" /> },
          { path: 'suppliers', element: <Parties kind="suppliers" /> },
          { path: 'reports/low-stock', element: <LowStock /> },
          { path: 'settings', element: <SettingsPage /> },
          // Manager-only, guarded here and on the API — see RequireManager.
          { path: 'users', element: <RequireManager><UsersPage /></RequireManager> },
          // Manager-only for the same reason, and with the same double guard:
          // the API refuses `/backup` outright for anyone else.
          { path: 'backup', element: <RequireManager><BackupPage /></RequireManager> },
          // A wrong URL now says so, inside the shell so navigation stays
          // available — it used to redirect silently, which reads as the app
          // having ignored you.
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export function App() {
  const status = useSession((s) => s.status);
  const queryClient = useQueryClient();

  // One user's cached data must never be visible to whoever signs in next.
  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status, queryClient]);

  // Only the initial auth check (Supabase's async getSession()) hits this —
  // local auth resolves synchronously, so it never sees 'loading'. Held here
  // rather than inside the router so neither guard has to special-case it.
  if (status === 'loading') return <Splash />;

  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}
