import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useToasts, type ToastTone } from '@/store/toast';
import { cn } from '@/lib/cn';

const TONE: Record<ToastTone, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'ring-emerald-500/25', iconColor: 'text-emerald-500' },
  error: { icon: XCircle, ring: 'ring-rose-500/25', iconColor: 'text-rose-500' },
  warning: { icon: AlertTriangle, ring: 'ring-amber-500/25', iconColor: 'text-amber-500' },
  info: { icon: Info, ring: 'ring-brand-500/25', iconColor: 'text-brand-500' },
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();

  return (
    <div
      className="fixed bottom-5 start-5 z-[100] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-2.5 no-print"
      role="region"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const { icon: Icon, ring, iconColor } = TONE[toast.tone];
        return (
          <div
            key={toast.id}
            className={cn(
              'card animate-toast-in flex items-start gap-3 p-3.5 ring-1',
              'shadow-lg backdrop-blur-sm',
              ring,
            )}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon className={cn('mt-0.5 size-5 shrink-0', iconColor)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{toast.title}</p>
              {toast.description && (
                <p className="mt-1 text-xs leading-relaxed text-muted break-words">{toast.description}</p>
              )}
              {toast.action && (
                <button
                  type="button"
                  onClick={() => { toast.action!.onClick(); dismiss(toast.id); }}
                  className="mt-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded-md p-1 text-subtle transition hover:bg-surface-2 hover:text-ink"
              aria-label="إغلاق"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
