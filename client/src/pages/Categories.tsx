import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Tags, Check, X } from 'lucide-react';
import {
  Button, Card, PageHeader, EmptyState, Modal, Field, Input, ConfirmDialog, Skeleton, Badge,
} from '@/components/ui';
import { useCategories, useCategoryMutations } from '@/hooks';
import { fmtInt } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import type { Category } from '@/lib/types';

export default function Categories() {
  const { data: categories = [], isLoading } = useCategories();
  const { create, rename, remove } = useCategoryMutations();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync(name.trim());
      toast.success('تم إنشاء التصنيف', name.trim());
      setName('');
      setShowCreate(false);
    } catch (error) {
      toastError(error, 'تعذّر إنشاء التصنيف');
    }
  };

  const submitRename = async () => {
    if (!editing || !editValue.trim() || editValue.trim() === editing.name) {
      setEditing(null);
      return;
    }
    try {
      await rename.mutateAsync({ id: editing.id, name: editValue.trim() });
      toast.success('تم تغيير الاسم');
      setEditing(null);
    } catch (error) {
      toastError(error, 'تعذّر تغيير الاسم');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.success('تم حذف التصنيف');
      setDeleteTarget(null);
    } catch (error) {
      toastError(error, 'تعذّر حذف التصنيف');
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <PageHeader
        title="التصنيفات"
        subtitle="جمّع الأصناف تحت تصنيفات تسهّل البحث والجرد"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setShowCreate(true)}>
            تصنيف جديد
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : categories.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tags className="size-6" />}
            title="لا توجد تصنيفات"
            message="أنشئ تصنيفات مثل «إلكترونيات» أو «قرطاسية» لتنظيم الأصناف. يمكن أيضاً إنشاؤها تلقائياً عند الاستيراد من Excel."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setShowCreate(true)}>
                إنشاء تصنيف
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((category) => {
            const isEditing = editing?.id === category.id;
            return (
              <Card key={category.id} className="group flex flex-col gap-3 p-4">
                {isEditing ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={editValue}
                      autoFocus
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      className="h-8 text-sm"
                    />
                    <Button size="icon" variant="success" className="size-8" onClick={submitRename} loading={rename.isPending}>
                      <Check className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{category.name}</p>
                      <Badge tone={category.item_count ? 'brand' : 'neutral'} className="mt-1.5">
                        {fmtInt(category.item_count)} صنف
                      </Badge>
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <Button
                        size="icon" variant="ghost" className="size-8" title="إعادة تسمية"
                        onClick={() => { setEditing(category); setEditValue(category.name); }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="size-8 hover:text-rose-500" title="حذف"
                        onClick={() => setDeleteTarget(category)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {!!category.item_count && (
                  <Link
                    to={`/items?category=${category.id}`}
                    className="mt-auto text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                  >
                    عرض الأصناف ←
                  </Link>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="تصنيف جديد"
        size="sm"
        footer={
          <>
            <Button onClick={() => setShowCreate(false)}>إلغاء</Button>
            <Button variant="primary" onClick={submitCreate} loading={create.isPending}>إنشاء</Button>
          </>
        }
      >
        <form onSubmit={submitCreate}>
          <Field label="اسم التصنيف" required hint="يجب أن يكون الاسم فريداً">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: إلكترونيات" />
          </Field>
          <button type="submit" className="hidden" aria-hidden />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        title="حذف التصنيف"
        confirmLabel="حذف"
        message={
          deleteTarget?.item_count
            ? <>لا يمكن حذف <strong className="text-ink">{deleteTarget.name}</strong> لأنه يحتوي على {fmtInt(deleteTarget.item_count)} صنف. أعد تصنيف هذه الأصناف أولاً.</>
            : <>سيتم حذف التصنيف <strong className="text-ink">{deleteTarget?.name}</strong> نهائياً.</>
        }
      />
    </>
  );
}
