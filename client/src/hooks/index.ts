import {
  useMutation, useQuery, useQueryClient, keepPreviousData, type UseQueryOptions,
} from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { subscribeInstallPrompt, getCanInstall, promptInstall } from '@/lib/installPrompt';
import type {
  BackupConfig, BackupSet, BackupStatus, BrowseResult, Category, DashboardStats, ImportPreview, ImportResult,
  Invoice, Item, ItemImage, ItemUnit, InvoiceSummary, Movement, OrgUser, Paginated, Party,
  PostProblem, RestoreResult, Settings, StockCount,
} from '@/lib/types';

/** Central query-key registry — keeps invalidation honest. */
export const keys = {
  dashboard: ['dashboard'] as const,
  settings: ['settings'] as const,
  categories: ['categories'] as const,
  items: (params?: unknown) => ['items', params] as const,
  item: (id: string) => ['item', id] as const,
  itemSearch: (q: string) => ['item-search', q] as const,
  movements: (params?: unknown) => ['movements', params] as const,
  parties: (kind: PartyKind, params?: unknown) => [kind, params] as const,
  party: (kind: PartyKind, id: string) => [kind, 'detail', id] as const,
  invoices: (params?: unknown) => ['invoices', params] as const,
  invoice: (id: string) => ['invoice', id] as const,
  invoiceValidation: (id: string) => ['invoice-validate', id] as const,
  stockCounts: (params?: unknown) => ['stock-counts', params] as const,
  stockCount: (id: string) => ['stock-count', id] as const,
  users: ['users'] as const,
  backup: ['backup'] as const,
};

export type PartyKind = 'customers' | 'suppliers';

/** Anything that changes stock invalidates these. */
const STOCK_KEYS = ['items', 'item', 'movements', 'dashboard', 'invoices', 'invoice', 'stock-counts', 'stock-count'];

export function useInvalidateStock() {
  const qc = useQueryClient();
  return () => STOCK_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
}

/** Debounce a rapidly-changing value (search boxes). */
export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Native "install app" prompt — a real desktop/home-screen icon, not a file download. */
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, getCanInstall, () => false);
  return { canInstall, promptInstall };
}

/* ---------------------------------------------------------------- generic */
type ListParams = Record<string, string | number | boolean | undefined>;
const listOptions = { placeholderData: keepPreviousData } as const;

/* ------------------------------------------------------------- dashboard */
/**
 * `enabled` exists because a clerk is refused `/dashboard` outright. The status
 * bar and both navs read these stats, so without the gate every screen that
 * role opens fired a request that came back 403 and logged a console error.
 */
export const useDashboard = (enabled = true) =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<DashboardStats>('/dashboard'), enabled });

export const useSettings = (options?: Partial<UseQueryOptions<Settings>>) =>
  useQuery({ queryKey: keys.settings, queryFn: () => api.get<Settings>('/settings'), ...options });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>('/settings', patch),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data);
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

/* ------------------------------------------------------------------ users */
type UserList = { data: OrgUser[]; can_create: boolean };

/** Manager-only; the endpoint 403s for anyone else, so the caller gates the query. */
export const useUsers = (enabled = true) =>
  useQuery({
    queryKey: keys.users,
    queryFn: () => api.get<UserList>('/users'),
    enabled,
  });

export function useUserMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.users });
  return {
    create: useMutation({
      mutationFn: (body: { username: string; password: string; role: OrgUser['role'] }) =>
        api.post<OrgUser>('/users', body),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: {
        id: string; role?: OrgUser['role']; password?: string; username?: string;
      }) => api.patch<OrgUser>(`/users/${id}`, body),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/users/${id}`),
      onSuccess: done,
    }),
  };
}

/* ----------------------------------------------------------------- backup */
/**
 * Manager-only, like `useUsers` — the endpoint 403s for anyone else, so the
 * caller gates the query rather than firing one that cannot succeed.
 *
 * `refetchInterval` is deliberately absent: a set list changes when someone on
 * this screen changes it, or once a night. Polling would spend a request a
 * minute to notice the latter a little sooner.
 */
export const useBackup = (enabled = true) =>
  useQuery({ queryKey: keys.backup, queryFn: () => api.get<BackupStatus>('/backup'), enabled });

/**
 * One level of the server's folder tree, for the copy-destination picker.
 *
 * `path: null` asks for the drive list. Not cached beyond the session default
 * and never retried: a folder that is missing or unreachable should say so at
 * once rather than after three attempts, and the message is the useful part.
 */
export const useBrowse = (path: string | null, enabled = true) =>
  useQuery({
    queryKey: ['backup-browse', path],
    queryFn: () => api.get<BrowseResult>('/backup/browse', path ? { path } : undefined),
    enabled,
    retry: false,
    staleTime: 0,
  });

export function useBackupMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.backup });

  return {
    create: useMutation({ mutationFn: () => api.post<BackupSet>('/backup'), onSuccess: done }),
    import: useMutation({
      mutationFn: (file: File) => api.upload<BackupSet>('/backup/import', file),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (name: string) => api.delete(`/backup/${encodeURIComponent(name)}`),
      onSuccess: done,
    }),
    saveConfig: useMutation({
      mutationFn: (patch: Partial<BackupConfig>) =>
        api.patch<{ config: BackupConfig }>('/backup/config', patch),
      onSuccess: done,
    }),
    restore: useMutation({
      mutationFn: (name: string) =>
        api.post<RestoreResult>(`/backup/${encodeURIComponent(name)}/restore`, { confirm: true }),
      /*
       * Everything cached describes a database that no longer exists — the
       * restore replaced it. Clearing rather than invalidating is the point:
       * invalidation would keep serving the old rows until each refetch lands,
       * which is precisely the window in which someone acts on stale stock.
       */
      onSuccess: () => qc.clear(),
    }),
  };
}

/* ------------------------------------------------------------- categories */
export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => api.get<{ data: Category[] }>('/categories').then((r) => r.data) });

export function useCategoryMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.categories });
    qc.invalidateQueries({ queryKey: ['items'] });
  };
  return {
    create: useMutation({ mutationFn: (name: string) => api.post<Category>('/categories', { name }), onSuccess: done }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<Category>(`/categories/${id}`, { name }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/categories/${id}`), onSuccess: done }),
  };
}

/* ------------------------------------------------------------------ items */
export const useItems = (params: ListParams, enabled = true) =>
  useQuery({
    queryKey: keys.items(params),
    queryFn: () => api.get<Paginated<Item>>('/items', params),
    enabled,
    ...listOptions,
  });

export const useItem = (id: string | undefined) =>
  useQuery({ queryKey: keys.item(id!), queryFn: () => api.get<Item>(`/items/${id}`), enabled: !!id });

export function useItemSearch(term: string, limit = 12) {
  const debounced = useDebounced(term, 250);
  // Both terms must be live: `debounced` alone would keep the last results for
  // another 250ms after the field was cleared, and `term` alone would fire a
  // request per keystroke.
  const enabled = term.trim().length > 0 && debounced.trim().length > 0;

  const query = useQuery({
    queryKey: keys.itemSearch(`${debounced}:${limit}`),
    queryFn: () => api.get<{ data: Item[] }>('/items/search', { q: debounced, limit }).then((r) => r.data),
    enabled,
    ...listOptions,
  });

  // `listOptions` carries `keepPreviousData`, which makes a *disabled* query
  // hold on to its last results. That is right while retyping — the list does
  // not flicker — but wrong once the term is gone: the suggestions would stay
  // on screen after picking one. An empty term has no results, full stop.
  return { ...query, data: enabled ? query.data : ([] as Item[]) };
}

export function useItemMutations() {
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const done = () => { invalidate(); qc.invalidateQueries({ queryKey: keys.categories }); };
  return {
    create: useMutation({ mutationFn: (body: Partial<Item>) => api.post<Item>('/items', body), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<Item> & { id: string }) => api.patch<Item>(`/items/${id}`, body),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/items/${id}`), onSuccess: done }),
    /** Append photos to the item's gallery. */
    addImages: useMutation({
      mutationFn: ({ id, files }: { id: string; files: File[] }) =>
        api.upload<{ data: ItemImage[] }>(`/items/${id}/images`, files, 'images'),
      onSuccess: done,
    }),
    removeImage: useMutation({
      mutationFn: ({ id, imageId }: { id: string; imageId: string }) =>
        api.delete<{ data: ItemImage[] }>(`/items/${id}/images/${imageId}`),
      onSuccess: done,
    }),
    /** Promote one photo to primary — it becomes the thumbnail everywhere. */
    setPrimaryImage: useMutation({
      mutationFn: ({ id, imageId }: { id: string; imageId: string }) =>
        api.post<{ data: ItemImage[] }>(`/items/${id}/images/${imageId}/primary`, {}),
      onSuccess: done,
    }),
    clearImages: useMutation({
      mutationFn: (id: string) => api.delete(`/items/${id}/images`),
      onSuccess: done,
    }),
    addSubBarcode: useMutation({
      mutationFn: ({ id, barcode, label }: { id: string; barcode: string; label?: string }) =>
        api.post(`/items/${id}/subbarcodes`, { barcode, label }),
      onSuccess: done,
    }),
    removeSubBarcode: useMutation({
      mutationFn: ({ id, sid }: { id: string; sid: string }) => api.delete(`/items/${id}/subbarcodes/${sid}`),
      onSuccess: done,
    }),
    addUnit: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Partial<ItemUnit>) =>
        api.post<ItemUnit>(`/items/${id}/units`, body),
      onSuccess: done,
    }),
    updateUnit: useMutation({
      mutationFn: ({ id, uid, ...body }: { id: string; uid: string } & Partial<ItemUnit>) =>
        api.patch<ItemUnit>(`/items/${id}/units/${uid}`, body),
      onSuccess: done,
    }),
    removeUnit: useMutation({
      mutationFn: ({ id, uid }: { id: string; uid: string }) => api.delete(`/items/${id}/units/${uid}`),
      onSuccess: done,
    }),
    /** Quick IN/OUT from the stock-movement modal. */
  };
}

/* -------------------------------------------------------------- movements */
export const useMovements = (params: ListParams) =>
  useQuery({ queryKey: keys.movements(params), queryFn: () => api.get<Paginated<Movement>>('/movements', params), ...listOptions });

/* ---------------------------------------------------------------- parties */
export const useParties = (kind: PartyKind, params: ListParams) =>
  useQuery({ queryKey: keys.parties(kind, params), queryFn: () => api.get<Paginated<Party>>(`/${kind}`, params), ...listOptions });

export const useParty = (kind: PartyKind, id: string | undefined) =>
  useQuery({ queryKey: keys.party(kind, id!), queryFn: () => api.get<Party>(`/${kind}/${id}`), enabled: !!id });

export function usePartyMutations(kind: PartyKind) {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: [kind] });
    qc.invalidateQueries({ queryKey: keys.dashboard });
  };
  return {
    create: useMutation({ mutationFn: (body: Partial<Party>) => api.post<Party>(`/${kind}`, body), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<Party> & { id: string }) => api.patch<Party>(`/${kind}/${id}`, body),
      onSuccess: done,
    }),
    archive: useMutation({ mutationFn: (id: string) => api.delete(`/${kind}/${id}`), onSuccess: done }),
    restore: useMutation({ mutationFn: (id: string) => api.post(`/${kind}/${id}/restore`), onSuccess: done }),
  };
}

/** Non-blocking duplicate-name check for party forms. */
export function useDuplicateName(kind: PartyKind, name: string, excludeId?: string) {
  const debounced = useDebounced(name, 400);
  return useQuery({
    queryKey: [kind, 'check-name', debounced, excludeId],
    queryFn: () => api.get<{ duplicate: { id: string; name: string } | null }>(
      `/${kind}/check-name`, { name: debounced, exclude_id: excludeId }).then((r) => r.duplicate),
    enabled: debounced.trim().length > 1,
  });
}

/* --------------------------------------------------------------- invoices */
/** The list response carries a `summary` block alongside the usual envelope. */
export const useInvoices = (params: ListParams) =>
  useQuery({
    queryKey: keys.invoices(params),
    queryFn: () => api.get<Paginated<Invoice> & { summary: InvoiceSummary }>('/invoices', params),
    ...listOptions,
  });

export const useInvoice = (id: string | undefined) =>
  useQuery({ queryKey: keys.invoice(id!), queryFn: () => api.get<Invoice>(`/invoices/${id}`), enabled: !!id });

export const useInvoiceValidation = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.invoiceValidation(id!),
    queryFn: () => api.get<{ ok: boolean; problems: PostProblem[] }>(`/invoices/${id}/validate`),
    enabled: !!id && enabled,
  });

export function useInvoiceMutations(invoiceId?: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const refresh = (invoice?: Invoice) => {
    if (invoice?.id) qc.setQueryData(keys.invoice(invoice.id), invoice);
    if (invoiceId) qc.invalidateQueries({ queryKey: keys.invoiceValidation(invoiceId) });
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post<Invoice>('/invoices', body),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Record<string, unknown> & { id: string }) =>
        api.patch<Invoice>(`/invoices/${id}`, body),
      onSuccess: refresh,
    }),
    addLine: useMutation({
      mutationFn: ({ id, ...body }: { id: string; barcode?: string; item_id?: string; unit_id?: string; quantity?: number; unit_price?: number }) =>
        api.post<{ invoice: Invoice; line_id: string; merged: boolean; item: Item }>(`/invoices/${id}/lines`, body),
      onSuccess: (result) => refresh(result.invoice),
    }),
    updateLine: useMutation({
      mutationFn: ({ id, lineId, ...body }: { id: string; lineId: string; quantity?: number; unit_id?: string | null; unit_price?: number; update_item_price?: boolean }) =>
        api.patch<Invoice>(`/invoices/${id}/lines/${lineId}`, body),
      onSuccess: refresh,
    }),
    removeLine: useMutation({
      mutationFn: ({ id, lineId }: { id: string; lineId: string }) =>
        api.delete<Invoice>(`/invoices/${id}/lines/${lineId}`),
      onSuccess: refresh,
    }),
    post: useMutation({
      mutationFn: (id: string) => api.post<Invoice>(`/invoices/${id}/post`),
      onSuccess: (invoice) => { invalidate(); refresh(invoice); },
    }),
    cancel: useMutation({
      mutationFn: (id: string) => api.post<Invoice>(`/invoices/${id}/cancel`),
      onSuccess: refresh,
    }),
    /*
     * Manager-only corrections to a posted document. Both move stock, so both
     * invalidate the stock caches the way `post` does — reversing an invoice
     * changes on-hand quantities just as surely as posting one did.
     */
    reverse: useMutation({
      mutationFn: (id: string) => api.post<Invoice>(`/invoices/${id}/reverse`),
      onSuccess: (invoice) => { invalidate(); refresh(invoice); },
    }),
    reopen: useMutation({
      mutationFn: (id: string) => api.post<Invoice>(`/invoices/${id}/reopen`),
      onSuccess: (invoice) => { invalidate(); refresh(invoice); },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/invoices/${id}`),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
    }),
  };
}

/* ----------------------------------------------------------- stock counts */
export const useStockCounts = (params: ListParams) =>
  useQuery({ queryKey: keys.stockCounts(params), queryFn: () => api.get<Paginated<StockCount>>('/stock-counts', params), ...listOptions });

export const useStockCount = (id: string | undefined) =>
  useQuery({ queryKey: keys.stockCount(id!), queryFn: () => api.get<StockCount>(`/stock-counts/${id}`), enabled: !!id });

export function useStockCountMutations() {
  const qc = useQueryClient();
  const invalidate = useInvalidateStock();
  const setSession = (session: StockCount) => {
    qc.setQueryData(keys.stockCount(session.id), session);
    qc.invalidateQueries({ queryKey: ['stock-counts'] });
  };

  return {
    create: useMutation({
      mutationFn: (body: { scope: string; category_id?: string | null; item_id?: string | null }) =>
        api.post<StockCount>('/stock-counts', body),
      onSuccess: setSession,
    }),
    updateLine: useMutation({
      mutationFn: ({ id, lineId, ...body }: { id: string; lineId: string; counted_quantity?: number | null; note?: string; skipped?: boolean }) =>
        api.patch<StockCount>(`/stock-counts/${id}/lines/${lineId}`, body),
      onSuccess: setSession,
    }),
    refreshExpected: useMutation({
      mutationFn: (id: string) => api.post<StockCount>(`/stock-counts/${id}/refresh-expected`),
      onSuccess: setSession,
    }),
    submit: useMutation({
      mutationFn: (id: string) => api.post<StockCount>(`/stock-counts/${id}/submit`),
      onSuccess: setSession,
    }),
    apply: useMutation({
      mutationFn: (id: string) => api.post<{ session: StockCount; invoices: Invoice[] }>(`/stock-counts/${id}/apply`),
      onSuccess: (result) => { invalidate(); setSession(result.session); },
    }),
    cancel: useMutation({
      mutationFn: (id: string) => api.post<StockCount>(`/stock-counts/${id}/cancel`),
      onSuccess: setSession,
    }),
  };
}

/* ----------------------------------------------------------------- import */
export function useImportMutations() {
  const invalidate = useInvalidateStock();
  return {
    preview: useMutation({ mutationFn: (file: File) => api.upload<ImportPreview>('/items/import/preview', file) }),
    commit: useMutation({
      mutationFn: (body: { upload_id: string; on_duplicate: 'skip' | 'update' }) =>
        api.post<ImportResult>('/items/import/commit', body),
      onSuccess: invalidate,
    }),
  };
}

/**
 * The screens that get the dense table: wide, and driven by a pointer.
 *
 * Kept identical to the media query behind `.device-table` in index.css --
 * `pointer: fine` is the part a width-only test gets wrong, because a tablet in
 * landscape is wide enough to pass one and is still a tablet.
 */
export const DEVICE_TABLE_QUERY = '(min-width: 1024px) and (pointer: fine)';

/** Live answer to a media query, so a resize or a rotation is not stale. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
