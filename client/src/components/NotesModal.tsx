import { useEffect, useState, type FormEvent } from 'react';
import {
  Loader2, Plus, Pin, PinOff, Pencil, Trash2, StickyNote, ArrowRight,
} from 'lucide-react';
import {
  Button, Modal, Input, Textarea, SearchInput, EmptyState, ConfirmDialog,
} from '@/components/ui';
import { useNotes, useNoteMutations, useDebounced } from '@/hooks';
import { toast, toastError } from '@/store/toast';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ManagerNote } from '@/lib/types';

/**
 * The manager's private notepad — many notes, searchable and filterable.
 *
 * Read and written only by a manager: the API guards every /notes verb with
 * requireManager, so this is the surface, not the boundary. Notes are per file
 * (per org) and never touch the settings table, which every role can read
 * (migration 010).
 *
 * Two views in one sheet: a searchable list, and an editor for one note. The
 * editor's draft is local and only saved on the button, so leaving it discards
 * the edit.
 */
export function NotesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  /** null = list; 'new' = fresh note; a note = editing that one. */
  const [editing, setEditing] = useState<ManagerNote | 'new' | null>(null);

  const debounced = useDebounced(search, 250);
  const { data, isLoading } = useNotes({ search: debounced, pinned: pinnedOnly }, open);
  const notes = data?.data ?? [];

  // Start clean each open — list view, no filters — so it never reopens mid-edit.
  useEffect(() => {
    if (!open) return;
    setSearch(''); setPinnedOnly(false); setEditing(null);
  }, [open]);

  if (editing !== null) {
    return (
      <NoteEditor
        note={editing === 'new' ? null : editing}
        onClose={onClose}
        onBack={() => setEditing(null)}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={(
        <div className="flex flex-col gap-2.5 pe-2">
          <span>ملاحظاتي</span>
          {/* Search + the pinned filter in the top bar, above the list. */}
          <div className="flex flex-wrap items-center gap-2.5 text-sm font-normal">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="ابحث في الملاحظات…"
              className="min-w-0 flex-1 sm:min-w-56"
            />
            <Button
              variant={pinnedOnly ? 'primary' : 'ghost'}
              onClick={() => setPinnedOnly((v) => !v)}
            >
              <Pin className="size-4" /> المثبتة
            </Button>
          </div>
        </div>
      )}
      footer={(
        <>
          <Button onClick={onClose}>إغلاق</Button>
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> ملاحظة جديدة
          </Button>
        </>
      )}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<StickyNote className="size-6" />}
          title={debounced || pinnedOnly ? 'لا ملاحظات مطابقة' : 'لا ملاحظات بعد'}
          message={debounced || pinnedOnly ? undefined : 'أضف أول ملاحظة بزر «ملاحظة جديدة».'}
        />
      ) : (
        <ul className="mx-auto max-w-3xl space-y-2">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} onEdit={() => setEditing(note)} />
          ))}
        </ul>
      )}
    </Modal>
  );
}

function NoteRow({ note, onEdit }: { note: ManagerNote; onEdit: () => void }) {
  const { update, remove } = useNoteMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const togglePin = () => update.mutate(
    { id: note.id, pinned: !note.pinned },
    { onError: (err: Error) => toastError(err, 'تعذّر التثبيت') },
  );

  return (
    <li className={cn('card p-3', note.pinned && 'ring-1 ring-brand-500/40')}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-start">
          <p className="truncate font-bold">
            {note.title || <span className="text-subtle">بلا عنوان</span>}
          </p>
          {note.body && (
            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">
              {note.body}
            </p>
          )}
          <p className="nums mt-1 text-[11px] text-subtle">{fmtDateTime(note.updated_at)}</p>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon" variant="ghost"
            title={note.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
            onClick={togglePin}
            className={cn(note.pinned && 'text-brand-600 dark:text-brand-400')}
          >
            {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
          <Button size="icon" variant="ghost" title="تعديل" onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon" variant="ghost" title="حذف"
            onClick={() => setConfirmDelete(true)}
            className="hover:bg-accent-500/10 hover:text-accent-600 dark:hover:text-accent-400"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(note.id, {
          onSuccess: () => { toast.success('حُذفت الملاحظة'); setConfirmDelete(false); },
          onError: (err: Error) => toastError(err, 'تعذّر الحذف'),
        })}
        title="حذف الملاحظة"
        message="سيُحذف هذا نهائياً."
        confirmLabel="حذف"
        loading={remove.isPending}
      />
    </li>
  );
}

function NoteEditor(
  { note, onClose, onBack }:
  { note: ManagerNote | null; onClose: () => void; onBack: () => void },
) {
  const { create, update } = useNoteMutations();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const busy = create.isPending || update.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const payload = { title: title.trim(), body };
    const opts = {
      onSuccess: () => { toast.success('حُفظت الملاحظة'); onBack(); },
      onError: (err: Error) => toastError(err, 'تعذّر الحفظ'),
    };
    if (note) update.mutate({ id: note.id, ...payload }, opts);
    else create.mutate(payload, opts);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      title={note ? 'تعديل ملاحظة' : 'ملاحظة جديدة'}
      footer={(
        <>
          <Button onClick={onBack} disabled={busy}>
            <ArrowRight className="size-4" /> رجوع
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!title.trim() && !body.trim()}>
            حفظ
          </Button>
        </>
      )}
    >
      <form onSubmit={submit} className="mx-auto max-w-3xl space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="العنوان"
          autoFocus
          maxLength={200}
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          placeholder="اكتب ملاحظتك هنا…"
          className="w-full resize-y leading-relaxed"
        />
      </form>
    </Modal>
  );
}
