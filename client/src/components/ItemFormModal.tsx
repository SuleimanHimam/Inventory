import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ImagePicker } from '@/components/ImagePicker';
import { useCategories, useItem, useItemMutations } from '@/hooks';
import { toast, toastError } from '@/store/toast';
import { usePrefs } from '@/store/prefs';
import type { Item } from '@/lib/types';

type Draft = {
  name: string; category_id: string; barcode: string;
  purchase_price: string; sale_price: string; low_stock_threshold: string;
};

const emptyDraft: Draft = {
  name: '', category_id: '', barcode: '',
  purchase_price: '', sale_price: '', low_stock_threshold: '',
};

/**
 * Create / edit an item. Also serves as the inline "quick create" used when an
 * unknown barcode is scanned — `lockedBarcode` pins the scanned value and
 * `onCreated` hands the new item straight back to the caller.
 */
export function ItemFormModal({
  open, onClose, item, lockedBarcode, onCreated, title,
}: {
  open: boolean;
  onClose: () => void;
  item?: Item | null;
  lockedBarcode?: string;
  onCreated?: (item: Item) => void;
  title?: string;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  // Photos chosen but not yet uploaded — a new item has no id to attach them
  // to until it has been created, so the upload happens after the save succeeds.
  const [newImages, setNewImages] = useState<File[]>([]);
  /** Server-side photos deleted in this session; applied on save. */
  const [droppedImages, setDroppedImages] = useState<string[]>([]);
  const { data: categories = [] } = useCategories();
  const { create, update, addImages, removeImage } = useItemMutations();
  // The row handed in by a list has no gallery — fetch the detail for it.
  const { data: detail } = useItem(item?.id);
  const gallery = (detail?.images ?? item?.images ?? [])
    .filter((image) => !droppedImages.includes(image.id));
  const nameRef = useRef<HTMLInputElement>(null);
  const threshold = usePrefs((s) => s.lowStockThreshold);

  const isEdit = !!item;
  const busy = create.isPending || update.isPending || addImages.isPending || removeImage.isPending;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setNewImages([]);
    setDroppedImages([]);
    setDraft(item
      ? {
        name: item.name,
        category_id: item.category_id ?? '',
        barcode: item.barcode,
        purchase_price: String(item.purchase_price),
        sale_price: String(item.sale_price),
        low_stock_threshold: item.low_stock_threshold === null ? '' : String(item.low_stock_threshold),
      }
      : { ...emptyDraft, barcode: lockedBarcode ?? '' });
  }, [open, item, lockedBarcode]);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = () => {
    const next: Partial<Record<keyof Draft, string>> = {};
    if (!draft.name.trim()) next.name = 'اسم الصنف مطلوب';
    if (!draft.barcode.trim()) next.barcode = 'الباركود مطلوب';
    for (const key of ['purchase_price', 'sale_price'] as const) {
      const raw = draft[key].trim();
      if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0))
        next[key] = 'أدخل رقماً غير سالب';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;

    const payload = {
      name: draft.name.trim(),
      category_id: draft.category_id || null,
      barcode: draft.barcode.trim(),
      purchase_price: Number(draft.purchase_price || 0),
      sale_price: Number(draft.sale_price || 0),
      low_stock_threshold: draft.low_stock_threshold === '' ? null : Number(draft.low_stock_threshold),
    };

    /**
     * Apply the photo changes once the item exists. A failure here is reported
     * but does not roll back the save — the item's data is already stored.
     */
    const syncImages = async (id: string) => {
      try {
        for (const imageId of droppedImages) await removeImage.mutateAsync({ id, imageId });
        if (newImages.length) await addImages.mutateAsync({ id, files: newImages });
      } catch (error) {
        toastError(error, 'حُفظ الصنف لكن تعذّر حفظ الصور');
      }
    };

    try {
      if (isEdit) {
        await update.mutateAsync({ id: item!.id, ...payload } as any);
        await syncImages(item!.id);
        toast.success('تم حفظ التعديلات', draft.name.trim());
      } else {
        const created = await create.mutateAsync(payload as any);
        await syncImages(created.id);
        toast.success('تم إنشاء الصنف', created.name);
        onCreated?.(created);
      }
      onClose();
    } catch (error) {
      toastError(error, isEdit ? 'تعذّر حفظ الصنف' : 'تعذّر إنشاء الصنف');
    }
  };

  const margin = Number(draft.sale_price || 0) - Number(draft.purchase_price || 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? (isEdit ? 'تعديل الصنف' : 'صنف جديد')}
      description={lockedBarcode
        ? `الباركود ${lockedBarcode} غير معروف — عرّف الصنف لإضافته إلى الفاتورة مباشرة.`
        : undefined}
      initialFocus={nameRef}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {isEdit ? 'حفظ التعديلات' : 'إنشاء الصنف'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="صور المنتج">
          <ImagePicker
            files={newImages}
            onChange={setNewImages}
            existing={gallery}
            onRemoveExisting={(id) => setDroppedImages((d) => [...d, id])}
            busy={addImages.isPending || removeImage.isPending}
          />
        </Field>

        <Field label="اسم الصنف" required error={errors.name}>
          <Input
            ref={nameRef}
            value={draft.name}
            onChange={(e) => set('name')(e.target.value)}
            placeholder="مثال: قلم حبر جاف أزرق"
            invalid={!!errors.name}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="الباركود الأساسي" required error={errors.barcode}
            hint={lockedBarcode ? 'مثبّت من عملية المسح' : 'امسح الباركود أو اكتبه'}>
            <Input
              value={draft.barcode}
              onChange={(e) => set('barcode')(e.target.value)}
              disabled={!!lockedBarcode}
              className="font-mono"
              invalid={!!errors.barcode}
            />
          </Field>

          <Field label="التصنيف">
            <Select value={draft.category_id} onChange={(e) => set('category_id')(e.target.value)}>
              <option value="">— بدون تصنيف —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="سعر الشراء" error={errors.purchase_price}>
            <Input
              type="number" step="0.01" min="0" inputMode="decimal"
              value={draft.purchase_price}
              onChange={(e) => set('purchase_price')(e.target.value)}
              placeholder="0.00"
              className="nums"
              invalid={!!errors.purchase_price}
            />
          </Field>
          <Field label="سعر البيع" error={errors.sale_price}
            hint={draft.sale_price && draft.purchase_price
              ? `هامش الربح ${margin.toFixed(2)}`
              : undefined}>
            <Input
              type="number" step="0.01" min="0" inputMode="decimal"
              value={draft.sale_price}
              onChange={(e) => set('sale_price')(e.target.value)}
              placeholder="0.00"
              className="nums"
              invalid={!!errors.sale_price}
            />
          </Field>
        </div>

        <Field
          label="حد التنبيه للنواقص"
          hint={`اتركه فارغاً لاستخدام الحد العام (${threshold})`}
        >
          <Input
            type="number" min="0" step="1" inputMode="numeric"
            value={draft.low_stock_threshold}
            onChange={(e) => set('low_stock_threshold')(e.target.value)}
            placeholder={String(threshold)}
            className="nums"
          />
        </Field>

        {!isEdit && (
          <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
            تبدأ كمية الصنف الجديد من صفر. أضف الرصيد الافتتاحي عبر فاتورة إدخال مخزون
            أو من زر «حركة مخزون» في صفحة الصنف.
          </p>
        )}

        {/* Allows Enter-to-submit without a visible duplicate button. */}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

/** Add a sub-barcode to an existing item. */
export function SubBarcodeModal({
  open, onClose, itemId,
}: { open: boolean; onClose: () => void; itemId: string }) {
  const [barcode, setBarcode] = useState('');
  const [label, setLabel] = useState('');
  const { addSubBarcode } = useItemMutations();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setBarcode(''); setLabel(''); } }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!barcode.trim()) return;
    try {
      await addSubBarcode.mutateAsync({ id: itemId, barcode: barcode.trim(), label: label.trim() || undefined });
      toast.success('تمت إضافة الباركود الفرعي', barcode.trim());
      onClose();
    } catch (error) {
      toastError(error, 'تعذّر إضافة الباركود');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة باركود فرعي"
      description="أي باركود فرعي يُرجع نفس الصنف عند المسح — مفيد لباركود المورد أو العلبة أو الباركود القديم."
      size="sm"
      initialFocus={ref}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={addSubBarcode.isPending}>إضافة</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="الباركود" required>
          <Input ref={ref} value={barcode} onChange={(e) => setBarcode(e.target.value)} className="font-mono" />
        </Field>
        <Field label="وصف اختياري" hint="مثال: كود المورد، باركود العلبة">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

/** Quick IN/OUT movement — posts a one-line auto invoice behind the scenes. */
export function StockMovementModal({
  open, onClose, item,
}: { open: boolean; onClose: () => void; item: Item | null }) {
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const { move } = useItemMutations();
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setType('IN'); setQuantity('1'); setNote(''); } }, [open]);

  if (!item) return null;

  const amount = Number(quantity || 0);
  const projected = type === 'IN' ? item.quantity + amount : item.quantity - amount;
  const invalid = !Number.isInteger(amount) || amount < 1;
  const wouldGoNegative = type === 'OUT' && projected < 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (invalid || wouldGoNegative) return;
    try {
      await move.mutateAsync({ id: item.id, type, quantity: amount, note: note.trim() || undefined });
      toast.success(
        type === 'IN' ? 'تم تسجيل حركة وارد' : 'تم تسجيل حركة صادر',
        `${item.name} — الرصيد الجديد ${projected}`,
      );
      onClose();
    } catch (error) {
      toastError(error, 'تعذّر تسجيل الحركة');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="حركة مخزون"
      description={item.name}
      size="sm"
      initialFocus={qtyRef}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button
            variant={type === 'IN' ? 'success' : 'danger'}
            onClick={submit}
            loading={move.isPending}
            disabled={invalid || wouldGoNegative}
          >
            تأكيد {type === 'IN' ? 'الإدخال' : 'الإخراج'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5">
          {(['IN', 'OUT'] as const).map((option) => {
            const active = type === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                className={[
                  'rounded-xl border-2 px-3 py-3 text-sm font-bold transition',
                  active && option === 'IN' && 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  active && option === 'OUT' && 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400',
                  !active && 'border-line bg-surface-2 text-muted hover:border-line-strong',
                ].filter(Boolean).join(' ')}
              >
                {option === 'IN' ? 'وارد (إضافة)' : 'صادر (خصم)'}
              </button>
            );
          })}
        </div>

        <Field label="الكمية" required>
          <Input
            ref={qtyRef}
            type="number" min="1" step="1" inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="nums text-lg font-bold"
            invalid={invalid || wouldGoNegative}
          />
        </Field>

        <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3.5 py-3 text-sm">
          <span className="text-muted">الرصيد الحالي</span>
          <span className="nums font-bold">{item.quantity}</span>
        </div>
        <div className={[
          'flex items-center justify-between rounded-lg px-3.5 py-3 text-sm',
          wouldGoNegative ? 'bg-rose-500/10' : 'bg-brand-500/10',
        ].join(' ')}>
          <span className="font-medium">الرصيد بعد الحركة</span>
          <span className={['nums text-lg font-bold', wouldGoNegative ? 'text-rose-500' : 'text-brand-600 dark:text-brand-400'].join(' ')}>
            {Number.isFinite(projected) ? projected : '—'}
          </span>
        </div>

        {wouldGoNegative && (
          <p className="text-xs font-medium text-rose-500">
            لا يمكن أن يصبح الرصيد سالباً. الحد الأقصى للإخراج هو {item.quantity}.
          </p>
        )}

        <Field label="ملاحظة" hint="سبب الحركة أو رقم مرجعي">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="مثال: تالف، مرتجع من عميل، صرف داخلي" />
        </Field>
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}
