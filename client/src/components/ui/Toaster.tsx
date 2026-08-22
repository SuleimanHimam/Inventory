import { AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useToasts, type ToastTone } from '@/store/toast';
import { cn } from '@/lib/cn';

/**
 * A checkmark that draws itself in, instead of a static tick appearing.
 *
 * This is the app's "it worked" moment, and it is deliberately small: it
 * fires on every save, post and delete — hundreds of times a shift in a
 * warehouse — so it reads as a quick, satisfying confirmation rather than a
 * celebration that demands attention. (Confetti was considered and rejected
 * for exactly that reason.)
 */
function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="10" className="stroke-current opacity-25" strokeWidth="2" />
      <path
        d="M7.5 12.5l3 3 6-6"
        className="stroke-current animate-check"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="24"
      />
    </svg>
  );
}

/** Both lucide icons and the local DrawnCheck satisfy this. */
type ToneIcon = React.ComponentType<{ className?: string }>;

const TONE: Record<ToastTone, { icon: ToneIcon; ring: string; iconColor: string }> = {
  success: { icon: DrawnCheck, ring: 'ring-emerald-500/30', iconColor: 'text-emerald-600 dark:text-emerald-400' },
  error: { icon: XCircle, ring: 'ring-accent-500/30', iconColor: 'text-accent-600 dark:text-accent-400' },
  warning: { icon: AlertTriangle, ring: 'ring-accent-500/30', iconColor: 'text-accent-700 dark:text-accent-400' },
  info: { icon: Info, ring: 'ring-sky-500/30', iconColor: 'text-sky-700 dark:text-sky-400' },
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
