import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Modal, Button } from '@/components/ui';

/**
 * Shown by `Shell` once `useIdleTimer` decides the user has been away too
 * long. Text comes from i18next (`idle.*` in ar.json/en.json) so it follows
 * whichever locale is active; layout direction follows `<html dir>` the same
 * way every other modal in the app does — nothing here is RTL-special-cased.
 */
export function IdleWarningModal({
  open, secondsLeft, onStay,
}: { open: boolean; secondsLeft: number; onStay: () => void }) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onStay}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Clock className="size-4 text-accent-500" />
          {t('idle.warningTitle')}
        </span>
      }
      footer={<Button variant="primary" size="lg" className="w-full" onClick={onStay}>{t('idle.stayLoggedIn')}</Button>}
    >
      <div className="space-y-3 text-center">
        <div className="nums text-4xl font-bold tabular-nums text-accent-600 dark:text-accent-400">
          {secondsLeft}
        </div>
        <p className="text-sm leading-relaxed text-muted">
          {t('idle.warningMessage', { seconds: secondsLeft })}
        </p>
      </div>
    </Modal>
  );
}
