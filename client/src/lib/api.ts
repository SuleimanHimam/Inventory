/**
 * Thin fetch wrapper around the REST API.
 *
 * The API is a separate deployment (Render) from this frontend (Vercel), so its
 * base URL is baked in at build time through `VITE_API_URL`. In development the
 * variable is usually left unset and requests go to a same-origin `/api/v1`,
 * which Vite proxies to the local server.
 *
 * Every call carries the Supabase access token; a 401 clears the session, which
 * sends the user back to the login screen.
 */
import { getAccessToken, onUnauthorized } from './session';

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export const API_BASE = `${API_ORIGIN}/api/v1`;

/**
 * Turn a server-relative media path (`/uploads/abc.png`) into something an
 * `<img>` can load. The API lives on another origin, so its own origin has to
 * be prepended; when `VITE_API_URL` is unset (dev) the path works as-is.
 */
export const mediaUrl = (path?: string | null): string | undefined => {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  return `${API_ORIGIN}${path}`;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  payload: Record<string, any>;

  constructor(status: number, message: string, payload: Record<string, any> = {}) {
    super(message);
    this.status = status;
    this.code = payload.code;
    this.payload = payload;
  }

  /** True when a scanned barcode matched no item — triggers inline creation. */
  get isUnknownBarcode() {
    return this.status === 404 && this.payload.item_not_found === true;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function toQuery(params: Query = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...await authHeaders(),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحقّق من الاتصال بالإنترنت وحاول مرة أخرى.');
  }

  if (response.status === 401) {
    onUnauthorized();
    throw new ApiError(401, 'انتهت صلاحية الجلسة — سجّل الدخول مرة أخرى', { code: 'AUTH_INVALID' });
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json().catch(() => ({})) : await response.text();

  if (!response.ok) {
    const payload = typeof body === 'object' && body ? body : {};
    throw new ApiError(response.status, payload.error || 'حدث خطأ غير متوقع', payload);
  }
  return body as T;
}

export const api = {
  get: <T,>(path: string, params?: Query) => request<T>(`${path}${toQuery(params)}`),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T,>(path: string, files: File | File[], field = 'file') => {
    const form = new FormData();
    for (const file of Array.isArray(files) ? files : [files]) form.append(field, file);
    return request<T>(path, { method: 'POST', body: form });
  },
  /** Stream a file endpoint straight to the user's downloads. */
  download: async (path: string, filename: string) => {
    const response = await fetch(`${API_BASE}${path}`, { headers: await authHeaders() });
    if (!response.ok) throw new ApiError(response.status, 'تعذّر تنزيل الملف');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
