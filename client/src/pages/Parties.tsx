import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Users, Truck, Pencil, Archive, ArchiveRestore, Phone, Mail, MapPin, AlertTriangle,
} from 'lucide-react';
import {
  Button, Card, PageHeader, Pagination, SearchInput, Select, EmptyState, TableSkeleton,
  Modal, Field, Input, Textarea, ConfirmDialog, Badge, Stat,
} from '@/components/ui';
import { InvoiceStatusBadge, InvoiceTypeBadge } from '@/components/domain';
import {
  useDebounced, useDuplicateName, useParties, useParty, usePartyMutations, type PartyKind,
} from '@/hooks';
import { fmtCurrency, fmtDateShort, fmtInt } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { toast, toastError } from '@/store/toast';
import type { Party } from '@/lib/types';

const CONFIG = {
  customers: {
    title: 'العملاء', singular: 'عميل', icon: Users,
    subtitle: 'سجلات العملاء المستخدمة في فواتير البيع',
  },
  suppliers: {
    title: 'الموردون', singular: 'مورد', icon: Truck,
    subtitle: 'سجلات الموردين المستخدمة في فواتير الشراء',
  },
} as const;

export default function Parties({ kind }: { kind: PartyKind }) {
  const config = CONFIG[kind];
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Party | null>(null);

  const debouncedSearch = useDebounced(search, 250);
  const { data, isLoading } = useParties(kind, {
    search: debouncedSearch || undefined,
    is_active: active || undefined,
    page,
    limit,
  });
  const { archive, restore } = usePartyMutations(kind);

  useEffect(() => { setPage(1); }, [debouncedSearch, active, limit, kind]);
  // Reset transient UI when switching between customers and suppliers.
  useEffect(() => { setSearch(''); setDetailId(null); setEditing(null); }, [kind]);

  // The ribbon links to ?new=1 to open the create form directly.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    setEditing(null);
    setFormOpen(true);
    params.delete('new');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const parties = data?.data ?? [];
  const Icon = config.icon;

  const doArchive = async () => {
    if (!archiveTarget) return;
    try {
      if (archiveTarget.is_active) {
        await archive.mutateAsync(archiveTarget.id);
        toast.success(`تمت أرشفة ${config.singular}`, 'يبقى السجل محفوظاً مع فواتيره');
      } else {
        await restore.mutateAsync(archiveTarget.id);
        toast.success('تمت إعادة التنشيط');
      }
      setArchiveTarget(null);
    } catch (error) {
      toastError(error, 'تعذّر تنفيذ العملية');
    }
  };

  return (
    <>
      <PageHeader
        title={config.title}
        subtitle={config.subtitle}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />}
            onClick={() => { setEditing(null); setFormOpen(true); }}>
            {config.singular} جديد
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line p-3.5">
          <SearchInput value={search} onValueChange={setSearch}
            placeholder="ابحث بالاسم أو الهاتف أو البريد…" className="min-w-56 flex-1" />
          <Select value={active} onChange={(e) => setActive(e.target.value)} className="w-auto min-w-36">
            <option value="true">النشطون</option>
            <option value="false">المؤرشفون</option>
            <option value="">الكل</option>
          </Select>
        </div>

        {isLoading ? (
          <TableSkeleton cols={5} />
        ) : parties.length === 0 ? (
          <EmptyState
            icon={<Icon className="size-6" />}
            title={debouncedSearch ? 'لا توجد نتائج مطابقة' : `لم يُسجَّل أي ${config.singular} بعد`}
            message={debouncedSearch
              ? 'جرّب كلمة بحث أخرى أو غيّر حالة العرض.'
              : `أضف سجلات ${config.title} لربطها بالفواتير وتتبّع تعاملاتها.`}
            action={
              <Button variant="primary" icon={<Plus className="size-4" />}
                onClick={() => { setEditing(null); setFormOpen(true); }}>
                إضافة {config.singular}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table stacked">
              <thead>
                <tr>
                  <th>الاسم</th>
                  {kind === 'suppliers' && <th>جهة الاتصال</th>}
                  <th>الهاتف</th>
                  <th>البريد الإلكتروني</th>
                  <th>الرقم الضريبي</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody>
                {parties.map((party) => (
                  <tr key={party.id} className="cursor-pointer" onClick={() => setDetailId(party.id)}>
                    <td>
                      <span className="font-semibold">{party.name}</span>
                      {!party.is_active && <Badge tone="neutral" className="ms-2">مؤرشف</Badge>}
                    </td>
                    {kind === 'suppliers' && (
                      <td className="text-xs text-muted">{party.contact_person || '—'}</td>
                    )}
                    <td data-label="الهاتف" className="nums text-xs">{party.phone || <span className="text-subtle">—</span>}</td>
                    <td data-label="البريد" className="max-w-[14rem] truncate text-xs text-muted">{party.email || '—'}</td>
                    <td data-label="الرقم الضريبي" className="nums text-xs text-muted">{party.tax_number || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-0.5">
                        <Button size="icon" variant="ghost" title="تعديل"
                          onClick={() => { setEditing(party); setFormOpen(true); }}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          title={party.is_active ? 'أرشفة' : 'إعادة تنشيط'}
                          className={party.is_active ? 'hover:text-accent-500' : 'hover:text-emerald-500'}
                          onClick={() => setArchiveTarget(party)}
                        >
                          {party.is_active ? <Archive className="size-4" /> : <ArchiveRestore className="size-4" />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && (
          <Pagination page={data.meta.page} pages={data.meta.pages} total={data.meta.total}
            limit={data.meta.limit} onPage={setPage} onLimit={setLimit} />
        )}
      </Card>

      <PartyFormModal
        kind={kind}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        party={editing}
      />

      <PartyDetailModal kind={kind} id={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={doArchive}
        loading={archive.isPending || restore.isPending}
        tone={archiveTarget?.is_active ? 'danger' : 'success'}
        title={archiveTarget?.is_active ? `أرشفة ${config.singular}` : 'إعادة التنشيط'}
        confirmLabel={archiveTarget?.is_active ? 'أرشفة' : 'إعادة تنشيط'}
        message={archiveTarget?.is_active
          ? <>سيُخفى <strong className="text-ink">{archiveTarget?.name}</strong> من قوائم الاختيار،
            مع الاحتفاظ الكامل بالسجل وفواتيره السابقة. الحذف النهائي غير متاح حفاظاً على سلامة السجلات.</>
          : <>سيعود <strong className="text-ink">{archiveTarget?.name}</strong> للظهور في قوائم الاختيار.</>}
      />
    </>
  );
}

function PartyFormModal({
  kind, open, onClose, party,
}: { kind: PartyKind; open: boolean; onClose: () => void; party: Party | null }) {
  const config = CONFIG[kind];
  const isEdit = !!party;
  const { create, update } = usePartyMutations(kind);

  const blank = {
    name: '', contact_person: '', phone: '', email: '', address: '', tax_number: '', notes: '',
  };
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState('');

  const { data: duplicate } = useDuplicateName(kind, isEdit ? '' : draft.name, party?.id);

  useEffect(() => {
    if (!open) return;
    setError('');
    setDraft(party
      ? {
        name: party.name,
        contact_person: party.contact_person ?? '',
        phone: party.phone ?? '',
        email: party.email ?? '',
        address: party.address ?? '',
        tax_number: party.tax_number ?? '',
        notes: party.notes ?? '',
      }
      : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, party]);

  const set = (key: keyof typeof blank) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) { setError('الاسم مطلوب'); return; }

    const payload: Record<string, string | null> = {
      name: draft.name.trim(),
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      address: draft.address.trim() || null,
      tax_number: draft.tax_number.trim() || null,
      notes: draft.notes.trim() || null,
    };
    if (kind === 'suppliers') payload.contact_person = draft.contact_person.trim() || null;

    try {
      if (isEdit) {
        await update.mutateAsync({ id: party!.id, ...payload } as any);
        toast.success('تم حفظ التعديلات');
      } else {
        await create.mutateAsync(payload as any);
        toast.success(`تمت إضافة ${config.singular}`, draft.name.trim());
      }
      onClose();
    } catch (err) {
      toastError(err, 'تعذّر الحفظ');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `تعديل بيانات ${config.singular}` : `${config.singular} جديد`}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending || update.isPending}>
            {isEdit ? 'حفظ التعديلات' : 'إضافة'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="الاسم" required error={error}>
          <Input value={draft.name} onChange={(e) => { set('name')(e.target.value); setError(''); }}
            placeholder={kind === 'customers' ? 'اسم العميل أو الشركة' : 'اسم المورد أو الشركة'} />
        </Field>

        {/* Duplicate names are allowed, but the user is warned. */}
        {duplicate && (
          <div className="flex items-start gap-2 rounded-lg border border-accent-500/30 bg-accent-500/8 px-3 py-2.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent-500" />
            <span className="text-muted">
              يوجد سجل بنفس الاسم «{duplicate.name}». يمكنك المتابعة، لكن تأكد أنك لا تنشئ تكراراً.
            </span>
          </div>
        )}

        {kind === 'suppliers' && (
          <Field label="جهة الاتصال">
            <Input value={draft.contact_person} onChange={(e) => set('contact_person')(e.target.value)}
              placeholder="اسم الشخص المسؤول" />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="الهاتف">
            <Input value={draft.phone} onChange={(e) => set('phone')(e.target.value)}
              className="nums" placeholder="05xxxxxxxx" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input type="email" value={draft.email} onChange={(e) => set('email')(e.target.value)}
              placeholder="name@example.com" dir="ltr" className="text-start" />
          </Field>
        </div>

        <Field label="العنوان">
          <Input value={draft.address} onChange={(e) => set('address')(e.target.value)} />
        </Field>

        <Field label="الرقم الضريبي">
          <Input value={draft.tax_number} onChange={(e) => set('tax_number')(e.target.value)} className="nums" />
        </Field>

        <Field label="ملاحظات">
          <Textarea value={draft.notes} onChange={(e) => set('notes')(e.target.value)} rows={2} />
        </Field>

        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

function PartyDetailModal({
  kind, id, onClose,
}: { kind: PartyKind; id: string | null; onClose: () => void }) {
  const { data: party } = useParty(kind, id ?? undefined);
  const { canSeePrices } = usePermissions();
  const config = CONFIG[kind];

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={party?.name ?? '…'}
      description={party?.is_active === false ? 'سجل مؤرشف' : undefined}
      size="lg"
      footer={<Button onClick={onClose}>إغلاق</Button>}
    >
      {!party ? (
        <p className="py-8 text-center text-sm text-muted">جارٍ التحميل…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="عدد الفواتير" value={fmtInt(party.stats?.invoice_count)} />
            {canSeePrices && (
              <Stat label="إجمالي التعاملات" value={fmtCurrency(party.stats?.total_value)} />
            )}
            <Stat label="آخر فاتورة" value={party.stats?.last_invoice_date
              ? fmtDateShort(party.stats.last_invoice_date) : '—'} />
            <Stat label="الرقم الضريبي" value={party.tax_number || '—'} />
          </div>

          <div className="grid gap-3 rounded-xl bg-surface-2 p-4 sm:grid-cols-2">
            <ContactRow icon={<Phone className="size-3.5" />} label="الهاتف" value={party.phone} />
            <ContactRow icon={<Mail className="size-3.5" />} label="البريد" value={party.email} />
            <ContactRow icon={<MapPin className="size-3.5" />} label="العنوان" value={party.address} />
            {kind === 'suppliers' && (
              <ContactRow icon={<Users className="size-3.5" />} label="جهة الاتصال" value={party.contact_person ?? null} />
            )}
          </div>

          {party.notes && (
            <div>
              <p className="mb-1 text-xs font-bold">ملاحظات</p>
              <p className="rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">{party.notes}</p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-bold">آخر الفواتير</p>
            {party.recent_invoices?.length ? (
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الرقم</th>
                      <th>النوع</th>
                      <th>التاريخ</th>
                      {canSeePrices && <th className="text-center">الإجمالي</th>}
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {party.recent_invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>
                          <Link to={`/invoices/${invoice.id}`} onClick={onClose}
                            className="nums font-mono text-xs font-bold text-brand-600 hover:underline dark:text-brand-400">
                            {invoice.number}
                          </Link>
                        </td>
                        <td><InvoiceTypeBadge type={invoice.type} withIcon={false} /></td>
                        <td className="nums text-xs text-muted">{fmtDateShort(invoice.invoice_date)}</td>
                        {canSeePrices && (
                          <td className="nums text-center font-semibold">{fmtCurrency(invoice.total)}</td>
                        )}
                        <td><InvoiceStatusBadge status={invoice.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-xs text-muted">
                لا توجد فواتير مرتبطة بهذا الـ{config.singular} بعد.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ContactRow({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <span className="mt-0.5 text-subtle">{icon}</span>
      <span className="text-subtle">{label}:</span>
      <span className="min-w-0 flex-1 break-words font-medium">{value || '—'}</span>
    </div>
  );
}
