import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Pencil, Plus, Trash2, Barcode, ArrowRight, Package, History,
  Image as ImageIcon, Ruler, StickyNote,
} from 'lucide-react';
import { ImageGallery } from '@/components/ImagePicker';
import {
  Button, Card, PageHeader, Badge, Skeleton, EmptyState, Stat, ConfirmDialog, Pagination,
} from '@/components/ui';
import { ItemFormModal, SubBarcodeModal, ItemUnitModal } from '@/components/ItemFormModal';
import {
  BarcodeChip, InvoiceLink, MovementBadge, QuantityCell, REFERENCE_LABEL,
} from '@/components/domain';
import { useItem, useItemMutations, useMovements } from '@/hooks';
import { fmtCurrency, fmtDateTime, fmtInt, fmtMoney } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import type { ItemUnit } from '@/lib/types';

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: item, isLoading } = useItem(id);
  const [page, setPage] = useState(1);
  const { data: movements } = useMovements({ item_id: id, page, limit: 15 });
  const { removeSubBarcode, removeImage, setPrimaryImage, removeUnit } = useItemMutations();
  const { canSeePrices } = usePermissions();

  const [showEdit, setShowEdit] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [subTarget, setSubTarget] = useState<{ id: string; barcode: string } | null>(null);
  /** Deleting a photo unlinks the file, so it is confirmed rather than instant. */
  const [imageToDelete, setImageToDelete] = useState<string | null>(null);
  const [showUnit, setShowUnit] = useState(false);
  const [editingUnit, setEditingUnit] = useState<ItemUnit | null>(null);
  const [unitToDelete, setUnitToDelete] = useState<ItemUnit | null>(null);
  const images = item?.images ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56 lg:col-span-2" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <Card>
        <EmptyState
          icon={<Package className="size-6" />}
          title="الصنف غير موجود"
          message="ربما تم حذفه أو أن الرابط غير صحيح."
          action={<Link to="/items"><Button variant="primary">العودة إلى الأصناف</Button></Link>}
        />
      </Card>
    );
  }

  // Both are absent for a staff role, and the block that renders them is
  // hidden for that role — `?? 0` here only keeps the arithmetic total.
  const purchase = item.purchase_price ?? 0;
  const margin = (item.sale_price ?? 0) - purchase;
  const marginPct = purchase > 0 ? (margin / purchase) * 100 : 0;

  const deleteSub = async () => {
    if (!subTarget) return;
    try {
      await removeSubBarcode.mutateAsync({ id: item.id, sid: subTarget.id });
      toast.success('تم حذف الباركود الفرعي');
      setSubTarget(null);
    } catch (error) {
      toastError(error, 'تعذّر حذف الباركود');
    }
  };

  const deleteImage = async () => {
    if (!imageToDelete) return;
    try {
      await removeImage.mutateAsync({ id: item.id, imageId: imageToDelete });
      toast.success('تم حذف الصورة');
      setImageToDelete(null);
    } catch (error) {
      toastError(error, 'تعذّر حذف الصورة');
    }
  };

  const deleteUnit = async () => {
    if (!unitToDelete) return;
    try {
      await removeUnit.mutateAsync({ id: item.id, uid: unitToDelete.id });
      toast.success('تم حذف الوحدة');
      setUnitToDelete(null);
    } catch (error) {
      toastError(error, 'تعذّر حذف الوحدة');
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/items" className="inline-flex items-center gap-1 hover:text-brand-500">
            <ArrowRight className="size-3" /> الأصناف
          </Link>
        }
        title={item.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <BarcodeChip code={item.barcode} />
            {item.category_name && <Badge tone="brand">{item.category_name}</Badge>}
            {item.source === 'IMPORT' && <Badge tone="info">مستورد من Excel</Badge>}
            {item.is_low_stock && <Badge tone="warning">تحت حد التنبيه</Badge>}
          </span>
        }
        actions={
          <>
            <Button variant="primary" icon={<Pencil className="size-4" />} onClick={() => setShowEdit(true)}>
              تعديل
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Photos */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <ImageIcon className="size-4 text-subtle" /> صور المنتج
            </h2>
            {!!images.length && (
              <span className="nums text-[11px] text-subtle">{fmtInt(images.length)}</span>
            )}
          </div>
          <div className="p-4">
            <ImageGallery
              images={images}
              busy={setPrimaryImage.isPending || removeImage.isPending}
              onSetPrimary={(imageId) =>
                setPrimaryImage.mutateAsync({ id: item.id, imageId })
                  .then(() => toast.success('تم تعيين الصورة الرئيسية'))
                  .catch((e) => toastError(e, 'تعذّر تعيين الصورة'))}
              onRemove={setImageToDelete}
            />
          </div>
        </Card>

        {/* Summary */}
        <Card className="p-5 lg:col-span-2">
          {/* Three price cells for a manager, none for anyone else — so the
              row collapses from four columns to one rather than leaving gaps. */}
          <div className={cn('grid gap-5', canSeePrices ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1')}>
            <div>
              <p className="text-[11px] font-medium text-subtle">الرصيد الحالي</p>
              <p className="mt-1 text-3xl font-bold leading-none">
                <QuantityCell quantity={item.quantity} threshold={item.effective_threshold} />
              </p>
              <p className="nums mt-1.5 text-[11px] text-subtle">
                حد التنبيه {fmtInt(item.effective_threshold)}
                {item.low_stock_threshold === null && ' (عام)'}
              </p>
            </div>
            {canSeePrices && (
              <>
                <Stat label="سعر الشراء" value={fmtCurrency(item.purchase_price)} />
                <Stat label="سعر البيع" value={fmtCurrency(item.sale_price)} />
                <Stat
                  label="هامش الربح"
                  value={`${fmtCurrency(margin)}${purchase > 0 ? ` (${marginPct.toFixed(0)}٪)` : ''}`}
                  tone={margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : margin < 0 ? 'text-accent-600 dark:text-accent-400' : undefined}
                />
              </>
            )}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
            <MiniStat label="إجمالي الوارد" value={fmtInt(item.stats?.total_in)} tone="text-emerald-600 dark:text-emerald-400" />
            <MiniStat label="إجمالي الصادر" value={fmtInt(item.stats?.total_out)} tone="text-accent-600 dark:text-accent-400" />
            <MiniStat label="عدد الحركات" value={fmtInt(item.stats?.movement_count)} />
          </div>

          {item.notes && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-subtle">
                <StickyNote className="size-3.5" /> ملاحظة
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{item.notes}</p>
            </div>
          )}
        </Card>

        {/* Sub-barcodes */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Barcode className="size-4 text-subtle" /> الباركودات الفرعية
            </h2>
            <Button size="sm" variant="subtle" icon={<Plus className="size-3.5" />} onClick={() => setShowSub(true)}>
              إضافة
            </Button>
          </div>

          {item.sub_barcodes?.length ? (
            <ul className="divide-y divide-line">
              {item.sub_barcodes.map((sub) => (
                <li key={sub.id} className="group flex items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="nums font-mono text-xs font-semibold">{sub.barcode}</p>
                    {sub.label && <p className="mt-0.5 text-[11px] text-subtle">{sub.label}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubTarget({ id: sub.id, barcode: sub.barcode })}
                    className="rounded p-1.5 text-subtle opacity-0 transition hover:bg-accent-500/10 hover:text-accent-600 dark:hover:text-accent-400 group-hover:opacity-100"
                    aria-label="حذف"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted">
              لا توجد باركودات فرعية.<br />أضف باركود المورد أو العلبة ليُرجع نفس الصنف عند المسح.
            </p>
          )}
        </Card>
      </div>

      {/* Units of measure */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Ruler className="size-4 text-subtle" /> وحدات القياس
          </h2>
          <Button size="sm" variant="subtle" icon={<Plus className="size-3.5" />}
            onClick={() => { setEditingUnit(null); setShowUnit(true); }}>
            إضافة وحدة
          </Button>
        </div>

        {item.units?.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الباركود</th>
                  <th className="text-center">عامل التحويل</th>
                  {canSeePrices && <th className="text-center">سعر الشراء</th>}
                  {canSeePrices && <th className="text-center">سعر البيع</th>}
                  <th className="text-center">الوزن</th>
                  <th className="text-center">الحجم</th>
                  <th aria-label="إجراءات" />
                </tr>
              </thead>
              <tbody>
                {item.units.map((unit) => {
                  const cbm = unit.cbm_m3
                    ?? (unit.length_cm && unit.width_cm && unit.height_cm
                      ? (unit.length_cm * unit.width_cm * unit.height_cm) / 1_000_000 : null);
                  return (
                    <tr key={unit.id}>
                      <td className="font-medium">{unit.name}</td>
                      <td className="nums font-mono text-xs">{unit.barcode}</td>
                      <td className="nums text-center">= {fmtMoney(unit.conversion_factor)} {item.name}</td>
                      {canSeePrices && <td className="nums text-center">{fmtCurrency(unit.purchase_price)}</td>}
                      {canSeePrices && <td className="nums text-center">{fmtCurrency(unit.sale_price)}</td>}
                      <td className="nums text-center text-xs text-muted">
                        {unit.weight_kg !== null ? `${unit.weight_kg} كغم` : '—'}
                      </td>
                      <td className="nums text-center text-xs text-muted">
                        {cbm !== null ? `${cbm.toFixed(3)} م³` : '—'}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => { setEditingUnit(unit); setShowUnit(true); }}
                            className="rounded p-1.5 text-subtle transition hover:bg-surface-2 hover:text-fg"
                            aria-label="تعديل"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setUnitToDelete(unit)}
                            className="rounded p-1.5 text-subtle transition hover:bg-accent-500/10 hover:text-accent-600 dark:hover:text-accent-400"
                            aria-label="حذف"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-xs leading-relaxed text-muted">
            لا توجد وحدات قياس بديلة.<br />أضف وحدات مثل «كرتونة» أو «علبة» لبيعها أو شرائها بسعر وباركود خاص بها.
          </p>
        )}
      </Card>

      {/* Movement history */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <History className="size-4 text-subtle" /> سجل الحركات
          </h2>
          <span className="nums text-xs text-muted">{fmtInt(movements?.meta.total)} حركة</span>
        </div>

        {movements?.data.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>النوع</th>
                    <th className="text-center">الكمية</th>
                    <th>المصدر</th>
                    <th>المستند</th>
                    <th>ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data.map((movement) => (
                    <tr key={movement.id}>
                      <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(movement.created_at)}</td>
                      <td><MovementBadge type={movement.type} /></td>
                      <td className={cn('nums text-center font-bold',
                        movement.type === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-accent-600 dark:text-accent-400')}>
                        {movement.type === 'IN' ? '+' : '−'}{fmtInt(movement.quantity)}
                      </td>
                      <td className="text-xs text-muted">{REFERENCE_LABEL[movement.reference_type]}</td>
                      <td><InvoiceLink id={movement.invoice_id!} number={movement.invoice_number} /></td>
                      <td className="max-w-xs truncate text-xs text-muted" title={movement.note ?? ''}>
                        {movement.note || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={movements.meta.page}
              pages={movements.meta.pages}
              total={movements.meta.total}
              limit={movements.meta.limit}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            icon={<History className="size-6" />}
            title="لا توجد حركات على هذا الصنف"
            message="أنشئ فاتورة إدخال لبدء تتبّع الرصيد — كل حركة مخزون تمر عبر فاتورة."
            action={(
              <Link to="/invoices/new?type=STOCK_IN">
                <Button variant="primary">إنشاء فاتورة إدخال</Button>
              </Link>
            )}
          />
        )}
      </Card>

      <ItemFormModal open={showEdit} onClose={() => setShowEdit(false)} item={item} />
      <SubBarcodeModal open={showSub} onClose={() => setShowSub(false)} itemId={item.id} />
      <ItemUnitModal
        open={showUnit}
        onClose={() => { setShowUnit(false); setEditingUnit(null); }}
        itemId={item.id}
        unit={editingUnit}
      />
      <ConfirmDialog
        open={!!unitToDelete}
        onClose={() => setUnitToDelete(null)}
        onConfirm={deleteUnit}
        loading={removeUnit.isPending}
        title="حذف وحدة القياس"
        confirmLabel="حذف"
        message={<>سيتم حذف الوحدة <strong>{unitToDelete?.name}</strong>. لن يمكن حذفها إن كانت مستخدمة في فاتورة.</>}
      />
      <ConfirmDialog
        open={!!subTarget}
        onClose={() => setSubTarget(null)}
        onConfirm={deleteSub}
        loading={removeSubBarcode.isPending}
        title="حذف الباركود الفرعي"
        confirmLabel="حذف"
        message={<>سيتوقف الباركود <strong className="nums font-mono">{subTarget?.barcode}</strong> عن الإشارة إلى هذا الصنف.</>}
      />

      <ConfirmDialog
        open={!!imageToDelete}
        onClose={() => setImageToDelete(null)}
        onConfirm={deleteImage}
        loading={removeImage.isPending}
        title="حذف الصورة"
        confirmLabel="حذف"
        message="سيُحذف ملف الصورة نهائياً ولا يمكن التراجع. إن كانت الصورة الرئيسية فستحل محلها التالية."
      />
    </>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-center">
      <p className="text-[11px] text-subtle">{label}</p>
      <p className={cn('nums mt-0.5 text-lg font-bold', tone)}>{value}</p>
    </div>
  );
}
