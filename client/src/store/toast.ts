import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
};

type ToastState = {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => number;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: ({ duration = 4200, ...toast }) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, duration }] }));
    if (duration > 0) setTimeout(() => useToasts.getState().dismiss(id), duration);
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helpers so components don't reach into the store directly. */
export const toast = {
  success: (title: string, description?: string) =>
    useToasts.getState().push({ tone: 'success', title, description }),
  error: (title: string, description?: string) =>
    useToasts.getState().push({ tone: 'error', title, description, duration: 6500 }),
  info: (title: string, description?: string) =>
    useToasts.getState().push({ tone: 'info', title, description }),
  warning: (title: string, description?: string) =>
    useToasts.getState().push({ tone: 'warning', title, description, duration: 5500 }),
  action: (title: string, label: string, onClick: () => void, description?: string) =>
    useToasts.getState().push({ tone: 'success', title, description, action: { label, onClick }, duration: 7000 }),
};

/** Normalise any thrown value into a toast. */
export const toastError = (error: unknown, fallback = 'حدث خطأ') => {
  const message = error instanceof Error ? error.message : String(error ?? fallback);
  toast.error(fallback, message === fallback ? undefined : message);
};
