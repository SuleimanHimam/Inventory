/**
 * Who is signed in, and what that role is allowed to see.
 *
 * The authority is the server — `lib/roles.js` strips money out of every
 * response a staff account receives, so nothing here is load-bearing for
 * secrecy. What this file is for is the *other* half: a column of blanks where
 * prices used to be is a worse interface than no column at all. So the UI asks
 * the same question the API already answered and lays itself out accordingly.
 *
 * Read that order carefully before adding a check: hiding a screen here does
 * not protect it. Anything that must not be reachable also needs a guard on
 * the route in `server/src/`.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Role = 'OWNER' | 'MEMBER' | 'CLERK';

/** resource key -> the five action flags. Sent by /me for the current role. */
export type PermissionMap = Record<string, {
  view: boolean; add: boolean; edit: boolean; delete: boolean; see_prices: boolean;
}>;

export type Me = {
  user: { id: string; email: string | null };
  org: { id: string; role: Role };
  permissions?: PermissionMap;
};

export const ROLE_LABEL: Record<Role, string> = { OWNER: 'مدير', MEMBER: 'موظف', CLERK: 'موظف مبيع' };

export const ROLE_HINT: Record<Role, string> = {
  OWNER: 'صلاحية كاملة: الأسعار والتقارير المالية وإدارة المستخدمين والإعدادات',
  MEMBER: 'العمل اليومي كاملاً — مسح وشراء ومبيع وجرد — بدون رؤية أي سعر',
  CLERK: 'دخول فواتير المبيع فقط، عبر البحث عن صنف — يرى سعر البيع دون تعديله. بلا لوحة معلومات ولا سجل فواتير.',
};

/**
 * The signed-in user. Cached for the session: a role changes rarely, and every
 * screen asks for it, so refetching on each mount would put a request in front
 * of every navigation for an answer that has not moved.
 */
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/me'),
    staleTime: Infinity,
    // Retry is left at the client default (twice, server errors only). This
    // request decides what the whole UI shows, and the failure below is
    // fail-closed — a manager who lost one request should get it retried
    // rather than spend the session looking at a price-free app.
  });

/**
 * What the current user may see.
 *
 * Fail-closed: while the role is loading, or if `/me` never answers, every
 * permission below is false. A price must never flash on screen before the app
 * finds out it should not be there, and an unknown role is not a manager.
 * `RequireManager` distinguishes the two states so a manager sees a spinner
 * rather than a refusal.
 */
export function usePermissions() {
  const { data, isLoading } = useMe();
  const role = data?.org.role ?? null;
  const perms = data?.permissions;
  /**
   * Ask the effective grid whether the current role may do `action` on
   * `resource`. Used to let custom roles reach screens the fixed three did not,
   * without disturbing the built-in flags below (which stay role-string based so
   * nothing about OWNER/MEMBER/CLERK changes). Fail-closed while loading.
   */
  const can = (resource: string, action: 'view' | 'add' | 'edit' | 'delete' | 'see_prices') =>
    !!perms?.[resource]?.[action];
  return {
    role,
    can,
    isLoading,
    isManager: role === 'OWNER',
    isClerk: role === 'CLERK',
    canSeePrices: role === 'OWNER',
    // The one thing a clerk gets that a plain staff account does not: an
    // item's sale price, wherever a screen specifically asks for this flag
    // instead of `canSeePrices`. Everywhere else (totals, purchase prices,
    // reports) still asks `canSeePrices`, so a clerk sees no more than a
    // staff account does anywhere but the invoice line it is entering.
    canSeeSalePrice: role === 'OWNER' || role === 'CLERK',
    // Seeing a price and being allowed to change it are different questions
    // for a clerk — it gets the first, never the second.
    canEditPrices: role === 'OWNER',
    /*
     * A clerk searches the catalogue; it does not maintain it. No new items,
     * no edits, no deletes, and no quick stock movement — every stock change
     * it makes goes through the one stock-out invoice it is there to enter.
     * Enforced on the API too (`requireItemWrite` in items.routes.js).
     */
    // These operational writes are grid-enforced on the API. Read from the grid
    // when it is present, and fall back to the fixed role otherwise — so a
    // built-in role behaves identically whether or not the map has loaded, and a
    // custom role's UI matches what the API will actually allow.
    canWriteItems: perms
      ? (can('items', 'add') || can('items', 'edit') || can('items', 'delete'))
      : (role === 'OWNER' || role === 'MEMBER'),
    canManageUsers: perms ? can('users', 'view') : role === 'OWNER',
    canImport: role === 'OWNER',
    canEditSettings: perms ? can('settings', 'edit') : role === 'OWNER',
    // A clerk's whole job is one screen (see RequireNotClerk); the dashboard
    // and the invoice list are neither shown nor reachable for it. Written as
    // an allow-list, not `role !== 'CLERK'`, so it fails closed like every
    // other flag here while the role is still loading.
    canSeeDashboard: role === 'OWNER' || role === 'MEMBER',
    canSeeInvoiceList: role === 'OWNER' || role === 'MEMBER',
    /*
     * Gates every nav item a clerk does not get (movements, stock-in, the
     * count/tools tabs, …). Written the same allow-list way and for the same
     * reason: `isClerk` is false while the role is still loading, so a check
     * written as `isClerk ? hide : show` shows the full nav for an instant on
     * every reload, then yanks it away the moment `/me` answers — exactly the
     * flash this flag exists to avoid. `!canSeeFullNav` hides the same items
     * during that instant instead, which is a much smaller, safer thing to
     * get briefly wrong, and disappears entirely once the role is known.
     */
    canSeeFullNav: role === 'OWNER' || role === 'MEMBER',
  };
}
