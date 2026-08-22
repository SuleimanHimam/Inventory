import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { usePermissions } from '@/lib/permissions';

/**
 * Wraps a screen a clerk account may not open — the dashboard and the invoice
 * list, both financial-shaped enough that even a role that can read a lone
 * sale price should not see them aggregated (see `canSeeSalePrice` in
 * lib/permissions.ts). A clerk's whole job is one screen (entering stock-out
 * invoices), so this sends it there instead of an "access denied" page: it
 * never typed the URL on purpose, it just landed on `/` like everyone else.
 *
 * The API refuses these routes on its own (`requireNotClerk` in
 * lib/roles.js) — this is what stands between a clerk and a screen that loads
 * and then fills with 403 toasts.
 */
export function RequireNotClerk({ children }: { children: React.ReactNode }) {
  const { isClerk, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (isClerk) return <Navigate to="/invoices/new" replace />;

  return <>{children}</>;
}
