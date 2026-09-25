import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Modal, Textarea } from '@/components/ui';
import { useNotes, useSaveNotes } from '@/hooks';
import { toast, toastError } from '@/store/toast';
import { fmtDateTime } from '@/lib/format';

/**
 * The manager's private notepad.
 *
 * One free-text note per file, read and written only by a manager -- the API
 * guards both /notes verbs with requireManager, so this is not the security
 * boundary, only the surface. It is deliberately NOT stored in settings, which
 * every role can read; see migration 009.
 *
 * The draft is local while the sheet is open and only saved on the button, so
 * closing without saving discards the edit -- and the textarea seeds from the
 * server each time it opens, so it never shows a stale draft from last time.
 */
export function NotesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useNotes(open);
  const save = useSaveNotes();
  const [body, setBody] = useState('');

  // Seed the draft from the server whenever the sheet opens or the saved note
  // arrives. Guarded on `open` so typing is never overwritten mid-edit.
  useEffect(() => {
    if (open) setBody(data?.body ?? '');
  }, [open, data?.body]);

  const dirty = body !== (data?.body ?? '');

  const commit = () => {
    save.mutate(body, {
      onSuccess: () => { toast.success('حُفظت الملاحظات'); onClose(); },
      onError: (err: Error) => toastError(err, 'تعذّر حفظ الملاحظات'),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ملاحظاتي"
      description="ملاحظات خاصة بك — يراها المدير وحده."
      footer={(
        <>
          <Button onClick={onClose} disabled={save.isPending}>إغلاق</Button>
          <Button variant="primary" onClick={commit} loading={save.isPending} disabled={!dirty}>
            حفظ
          </Button>
        </>
      )}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            autoFocus
            placeholder="اكتب ملاحظاتك هنا…"
            className="w-full resize-y leading-relaxed"
          />
          {data?.updated_at && (
            <p className="mt-2 text-[11px] text-subtle">
              آخر تعديل: <span className="nums">{fmtDateTime(data.updated_at)}</span>
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
