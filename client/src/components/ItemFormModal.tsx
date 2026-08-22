import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ImagePicker } from '@/components/ImagePicker';
import { useCategories, useItem, useItemMutations } from '@/hooks';
import { toast, toastError } from '@/store/toast';
import { usePrefs } from '@/store/prefs';
import { usePermissions } from '@/lib/permissions';
import type { Item, ItemUnit } from '@/lib/types';

/**
 * cm³ → m³ from the three carton dimensions, or null if any is missing/invalid.
 * Only ever called from a dimension field's own onChange — never on mount —
 * so opening an existing item never silently overwrites a CBM a supplier
 * gave directly, without matching L×W×H.
 */
function cbmFromDimensions(length: string, width: string, height: string): string | null {
  if (!length.trim() || !width.trim() || !height.trim()) return null;
  const l = Number(length);
  const w = Number(width);
  const h = Number(height);
  if (![l, w, h].every((n) => Number.isFinite(n) && n > 0)) return null;
  return String(Math.round((l * w * h / 1_000_000) * 10_000) / 10_000);
}

/**
 * The reverse direction: a CBM entered directly (no dimensions given) implies
 * no unique L×W×H — only their product — so this assumes a cube and returns
 * its side length in cm, as a starting point the user can still adjust.
 */
function sizeFromCbm(cbm: string): string | null {
  const value = Number(cbm);
  if (!cbm.trim() || !Number.isFinite(value) || value <= 0) return null;
  const sideCm = Math.cbrt(value * 1_000_000);
  return String(Math.round(sideCm * 10) / 10);
}

type Draft = {
  name: string; category_id: string; barcode: string; notes: string;
  purchase_price: string; sale_price: string; low_stock_threshold: string;
  weight_kg: string; length_cm: string; width_cm: string; height_cm: string; cbm_m3: string;
};

const emptyDraft: Draft = {
  name: '', category_id: '', barcode: '', notes: '',
  purchase_price: '', sale_price: '', low_stock_threshold: '',
  weight_kg: '', length_cm: '', width_cm: '', height_cm: '', cbm_m3: '',
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
  const { canSeePrices } = usePermissions();
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
    const dim = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
    setDraft(item
      ? {
        name: item.name,
        category_id: item.category_id ?? '',
        barcode: item.barcode ?? '',
        notes: item.notes ?? '',
        // `?? ''` rather than `?? 0`: for a staff role these keys are absent
        // from the response, and `String(undefined)` would put the literal
        // text "undefined" into the field.
        purchase_price: item.purchase_price === undefined ? '' : String(item.purchase_price),
        sale_price: item.sale_price === undefined ? '' : String(item.sale_price),
        low_stock_threshold: item.low_stock_threshold === null ? '' : String(item.low_stock_threshold),
        weight_kg: dim(item.weight_kg),
        length_cm: dim(item.length_cm),
        width_cm: dim(item.width_cm),
        height_cm: dim(item.height_cm),
        cbm_m3: dim(item.cbm_m3),
      }
      : { ...emptyDraft, barcode: lockedBarcode ?? '' });
  }, [open, item, lockedBarcode]);

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === 'length_cm' || key === 'width_cm' || key === 'height_cm') {
        const cbm = cbmFromDimensions(next.length_cm, next.width_cm, next.height_cm);
        if (cbm !== null) next.cbm_m3 = cbm;
      }
      if (key === 'cbm_m3') {
        if (!value.trim()) {
          // Cleared — take the guessed/connected dimensions down with it.
          next.length_cm = ''; next.width_cm = ''; next.height_cm = '';
        } else if (!d.length_cm.trim() && !d.width_cm.trim() && !d.height_cm.trim()) {
          // Only when the dimensions are still blank — never overwrite real
          // ones with a guessed cube just because CBM was edited afterward.
          const side = sizeFromCbm(value);
          if (side !== null) { next.length_cm = side; next.width_cm = side; next.height_cm = side; }
        }
      }
      return next;
    });
    setErrors((e) => ({
      ...e, [key]: undefined, cbm_m3: undefined, length_cm: undefined, width_cm: undefined, height_cm: undefined,
    }));
  };

  const validate = () => {
    const next: Partial<Record<keyof Draft, string>> = {};
    if (!draft.name.trim()) next.name = 'اسم الصنف مطلوب';
    for (const key of ['purchase_price', 'sale_price', 'weight_kg', 'length_cm', 'width_cm', 'height_cm', 'cbm_m3'] as const) {
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

    const dim = (raw: string) => (raw.trim() === '' ? null : Number(raw));
    const payload = {
      name: draft.name.trim(),
      category_id: draft.category_id || null,
      barcode: draft.barcode.trim() || null,
      notes: draft.notes.trim() || null,
      purchase_price: Number(draft.purchase_price || 0),
      sale_price: Number(draft.sale_price || 0),
      low_stock_threshold: draft.low_stock_threshold === '' ? null : Number(draft.low_stock_threshold),
      weight_kg: dim(draft.weight_kg),
      length_cm: dim(draft.length_cm),
      width_cm: dim(draft.width_cm),
      height_cm: dim(draft.height_cm),
      cbm_m3: dim(draft.cbm_m3),
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
      size="full"
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
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
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
          <Field label="الباركود الأساسي" error={errors.barcode}
            hint={lockedBarcode ? 'مثبّت من عملية المسح' : 'اختياري — اتركه فارغاً إذا لم يكن للصنف باركود'}>
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

        {/* A role that cannot read a price cannot set one. The server drops
            these fields from the request body anyway (lib/roles.js), so an
            item created by staff simply keeps whatever price it already had —
            zero for a new one, for a manager to fill in later. */}
        {canSeePrices && (
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
        )}

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

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="الوزن (كغم)" error={errors.weight_kg}>
            <Input
              type="number" step="0.001" min="0" inputMode="decimal"
              value={draft.weight_kg}
              onChange={(e) => set('weight_kg')(e.target.value)}
              placeholder="0.000" className="nums" invalid={!!errors.weight_kg}
            />
          </Field>
          <Field label="الطول (سم)" error={errors.length_cm}>
            <Input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={draft.length_cm}
              onChange={(e) => set('length_cm')(e.target.value)}
              placeholder="0.0" className="nums" invalid={!!errors.length_cm}
            />
          </Field>
          <Field label="العرض (سم)" error={errors.width_cm}>
            <Input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={draft.width_cm}
              onChange={(e) => set('width_cm')(e.target.value)}
              placeholder="0.0" className="nums" invalid={!!errors.width_cm}
            />
          </Field>
          <Field label="الارتفاع (سم)" error={errors.height_cm}>
            <Input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={draft.height_cm}
              onChange={(e) => set('height_cm')(e.target.value)}
              placeholder="0.0" className="nums" invalid={!!errors.height_cm}
            />
          </Field>
        </div>

        <Field label="حجم الكرتونة CBM (م³)" error={errors.cbm_m3}
          hint="اختياري — يُدخل مباشرة أو يُحسب من الأبعاد أعلاه">
          <Input
            type="number" step="0.0001" min="0" inputMode="decimal"
            value={draft.cbm_m3}
            onChange={(e) => set('cbm_m3')(e.target.value)}
            placeholder="0.0000" className="nums" invalid={!!errors.cbm_m3}
          />
        </Field>

        <Field label="ملاحظة" hint="اختياري — شروط المورد، مكان التخزين، أو أي تفصيل آخر">
          <Textarea
            value={draft.notes}
            onChange={(e) => set('notes')(e.target.value)}
            rows={3}
            placeholder="مثال: يُخزَّن في مكان بارد وجاف"
          />
        </Field>

        {!isEdit && (
          <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
            تبدأ كمية الصنف الجديد من صفر. أضف الرصيد الافتتاحي عبر فاتورة إدخال مخزون.
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

type UnitDraft = {
  name: string; barcode: string; conversion_factor: string;
  purchase_price: string; sale_price: string;
  weight_kg: string; length_cm: string; width_cm: string; height_cm: string; cbm_m3: string;
};

const emptyUnitDraft: UnitDraft = {
  name: '', barcode: '', conversion_factor: '',
  purchase_price: '', sale_price: '',
  weight_kg: '', length_cm: '', width_cm: '', height_cm: '', cbm_m3: '',
};

/** Create or edit one alternate unit (e.g. "Box of 12") for an existing item. */
export function ItemUnitModal({
  open, onClose, itemId, unit,
}: { open: boolean; onClose: () => void; itemId: string; unit?: ItemUnit | null }) {
  const [draft, setDraft] = useState<UnitDraft>(emptyUnitDraft);
  const [errors, setErrors] = useState<Partial<Record<keyof UnitDraft, string>>>({});
  const { addUnit, updateUnit } = useItemMutations();
  const { canSeePrices } = usePermissions();
  const ref = useRef<HTMLInputElement>(null);
  const isEdit = !!unit;
  const busy = addUnit.isPending || updateUnit.isPending;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    const dim = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
    setDraft(unit
      ? {
        name: unit.name,
        barcode: unit.barcode,
        conversion_factor: String(unit.conversion_factor),
        purchase_price: String(unit.purchase_price ?? ''),
        sale_price: String(unit.sale_price ?? ''),
        weight_kg: dim(unit.weight_kg),
        length_cm: dim(unit.length_cm),
        width_cm: dim(unit.width_cm),
        height_cm: dim(unit.height_cm),
        cbm_m3: dim(unit.cbm_m3),
      }
      : emptyUnitDraft);
  }, [open, unit]);

  const set = (key: keyof UnitDraft) => (value: string) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === 'length_cm' || key === 'width_cm' || key === 'height_cm') {
        const cbm = cbmFromDimensions(next.length_cm, next.width_cm, next.height_cm);
        if (cbm !== null) next.cbm_m3 = cbm;
      }
      if (key === 'cbm_m3') {
        if (!value.trim()) {
          next.length_cm = ''; next.width_cm = ''; next.height_cm = '';
        } else if (!d.length_cm.trim() && !d.width_cm.trim() && !d.height_cm.trim()) {
          const side = sizeFromCbm(value);
          if (side !== null) { next.length_cm = side; next.width_cm = side; next.height_cm = side; }
        }
      }
      return next;
    });
    setErrors((e) => ({
      ...e, [key]: undefined, cbm_m3: undefined, length_cm: undefined, width_cm: undefined, height_cm: undefined,
    }));
  };

  const validate = () => {
    const next: Partial<Record<keyof UnitDraft, string>> = {};
    if (!draft.name.trim()) next.name = 'اسم الوحدة مطلوب';
    if (!draft.barcode.trim()) next.barcode = 'باركود الوحدة مطلوب';
    const factor = Number(draft.conversion_factor);
    if (!draft.conversion_factor.trim() || !Number.isFinite(factor) || factor <= 0) {
      next.conversion_factor = 'أدخل رقماً أكبر من صفر';
    }
    for (const key of ['purchase_price', 'sale_price', 'weight_kg', 'length_cm', 'width_cm', 'height_cm', 'cbm_m3'] as const) {
      const raw = draft[key].trim();
      if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) next[key] = 'أدخل رقماً غير سالب';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    const dim = (raw: string) => (raw.trim() === '' ? null : Number(raw));
    const payload = {
      name: draft.name.trim(),
      barcode: draft.barcode.trim(),
      conversion_factor: Number(draft.conversion_factor),
      purchase_price: Number(draft.purchase_price || 0),
      sale_price: Number(draft.sale_price || 0),
      weight_kg: dim(draft.weight_kg),
      length_cm: dim(draft.length_cm),
      width_cm: dim(draft.width_cm),
      height_cm: dim(draft.height_cm),
      cbm_m3: dim(draft.cbm_m3),
    };
    try {
      if (isEdit) {
        await updateUnit.mutateAsync({ id: itemId, uid: unit!.id, ...payload });
        toast.success('تم حفظ الوحدة', draft.name.trim());
      } else {
        await addUnit.mutateAsync({ id: itemId, ...payload });
        toast.success('تمت إضافة الوحدة', draft.name.trim());
      }
      onClose();
    } catch (error) {
      toastError(error, isEdit ? 'تعذّر حفظ الوحدة' : 'تعذّر إضافة الوحدة');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'تعديل وحدة القياس' : 'إضافة وحدة قياس'}
      description="مثال: علبة 12 قطعة، كرتونة 144 قطعة — لكل وحدة باركود وسعر خاص بها."
      size="lg"
      initialFocus={ref}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {isEdit ? 'حفظ التعديلات' : 'إضافة'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="اسم الوحدة" required error={errors.name}>
            <Input ref={ref} value={draft.name} onChange={(e) => set('name')(e.target.value)}
              placeholder="مثال: كرتونة" invalid={!!errors.name} />
          </Field>
          <Field label="الباركود" required error={errors.barcode}>
            <Input value={draft.barcode} onChange={(e) => set('barcode')(e.target.value)}
              className="font-mono" invalid={!!errors.barcode} />
          </Field>
        </div>

        <Field label="عامل التحويل" required error={errors.conversion_factor}
          hint="كم من الوحدة الأساسية تساوي هذه الوحدة — مثال: 12">
          <Input
            type="number" step="0.001" min="0" inputMode="decimal"
            value={draft.conversion_factor}
            onChange={(e) => set('conversion_factor')(e.target.value)}
            placeholder="12" className="nums" invalid={!!errors.conversion_factor}
          />
        </Field>

        {canSeePrices && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="سعر الشراء" error={errors.purchase_price}>
              <Input
                type="number" step="0.01" min="0" inputMode="decimal"
                value={draft.purchase_price}
                onChange={(e) => set('purchase_price')(e.target.value)}
                placeholder="0.00" className="nums" invalid={!!errors.purchase_price}
              />
            </Field>
            <Field label="سعر البيع" error={errors.sale_price}>
              <Input
                type="number" step="0.01" min="0" inputMode="decimal"
                value={draft.sale_price}
                onChange={(e) => set('sale_price')(e.target.value)}
                placeholder="0.00" className="nums" invalid={!!errors.sale_price}
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="الوزن (كغم)" error={errors.weight_kg}>
            <Input
              type="number" step="0.001" min="0" inputMode="decimal"
              value={draft.weight_kg}
              onChange={(e) => set('weight_kg')(e.target.value)}
              placeholder="0.000" className="nums" invalid={!!errors.weight_kg}
            />
          </Field>
          <Field label="الطول (سم)" error={errors.length_cm}>
            <Input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={draft.length_cm}
              onChange={(e) => set('length_cm')(e.target.value)}
              placeholder="0.0" className="nums" invalid={!!errors.length_cm}
            />
          </Field>
          <Field label="العرض (سم)" error={errors.width_cm}>
            <Input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={draft.width_cm}
              onChange={(e) => set('width_cm')(e.target.value)}
              placeholder="0.0" className="nums" invalid={!!errors.width_cm}
            />
          </Field>
          <Field label="الارتفاع (سم)" error={errors.height_cm}>
            <Input
              type="number" step="0.1" min="0" inputMode="decimal"
              value={draft.height_cm}
              onChange={(e) => set('height_cm')(e.target.value)}
              placeholder="0.0" className="nums" invalid={!!errors.height_cm}
            />
          </Field>
        </div>

        <Field label="حجم الكرتونة CBM (م³)" error={errors.cbm_m3}
          hint="اختياري — يُدخل مباشرة أو يُحسب من الأبعاد أعلاه">
          <Input
            type="number" step="0.0001" min="0" inputMode="decimal"
            value={draft.cbm_m3}
            onChange={(e) => set('cbm_m3')(e.target.value)}
            placeholder="0.0000" className="nums" invalid={!!errors.cbm_m3}
          />
        </Field>

        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

/** Quick IN/OUT movement — posts a one-line auto invoice behind the scenes. */
