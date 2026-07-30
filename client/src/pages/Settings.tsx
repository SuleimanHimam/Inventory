import { useEffect, useState } from 'react';
import { Save, Monitor, Database, Languages, Building2, Info } from 'lucide-react';
import { Button, Card, PageHeader, Field, Input, Select, Toggle, Stat } from '@/components/ui';
import { useSettings, useUpdateSettings } from '@/hooks';
import { usePrefs } from '@/store/prefs';
import { API_BASE } from '@/lib/api';
import { AUTH_ENABLED, useSession } from '@/lib/session';
import { fmtCurrency, fmtInt } from '@/lib/format';
import { toast, toastError } from '@/store/toast';
import type { Settings as SettingsType } from '@/lib/types';

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { theme, setTheme } = usePrefs();
  const email = useSession((s) => s.email);
  const [draft, setDraft] = useState<Partial<SettingsType>>({});

  useEffect(() => { if (settings) setDraft(settings); }, [settings]);

  const set = <K extends keyof SettingsType>(key: K) => (value: SettingsType[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const dirty = !!settings && (Object.keys(draft) as Array<keyof SettingsType>)
    .some((key) => String(draft[key]) !== String(settings[key]));

  const save = async () => {
    try {
      await update.mutateAsync(draft);
      toast.success('تم حفظ الإعدادات');
    } catch (error) {
      toastError(error, 'تعذّر حفظ الإعدادات');
    }
  };

  return (
    <>
      <PageHeader
        title="الإعدادات"
        subtitle="إعدادات عامة تسري على كامل النظام"
        actions={
          <Button variant="primary" icon={<Save className="size-4" />} onClick={save}
            loading={update.isPending} disabled={!dirty}>
            حفظ التغييرات
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Building2 className="size-4 text-subtle" /> بيانات المنشأة
          </h2>
          <div className="mt-4 space-y-4">
            <Field label="اسم المنشأة" hint="يظهر في القائمة الجانبية وعلى الفواتير المطبوعة">
              <Input value={draft.company_name ?? ''} onChange={(e) => set('company_name')(e.target.value)} />
            </Field>
            <Field label="رمز العملة" hint="يظهر بجانب كل مبلغ، مثال: ILS أو JOD أو USD">
              <Input value={draft.currency ?? ''} onChange={(e) => set('currency')(e.target.value)}
                className="nums" maxLength={10} />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Database className="size-4 text-subtle" /> المخزون
          </h2>
          <div className="mt-4 space-y-4">
            <Field
              label="حد التنبيه العام للنواقص"
              hint="يُستخدم لكل صنف لم يُحدَّد له حد خاص. الأصناف التي يقل رصيدها عن هذا الحد أو يساويه تظهر في تقرير النواقص."
            >
              <Input type="number" min="0" step="1" inputMode="numeric" className="nums"
                value={draft.low_stock_threshold ?? ''}
                onChange={(e) => set('low_stock_threshold')(e.target.value)} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="أقصى عدد صفوف للاستيراد">
                <Input type="number" min="1" step="100" inputMode="numeric" className="nums"
                  value={draft.import_max_rows ?? ''}
                  onChange={(e) => set('import_max_rows')(e.target.value)} />
              </Field>
              <Field label="أقصى حجم للملف (ميغابايت)">
                <Input type="number" min="1" step="1" inputMode="numeric" className="nums"
                  value={draft.import_max_file_mb ?? ''}
                  onChange={(e) => set('import_max_file_mb')(e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Languages className="size-4 text-subtle" /> اللغة والعرض
          </h2>
          <div className="mt-4 space-y-4">
            <Field label="لغة الواجهة" hint="العربية هي اللغة الأساسية مع تخطيط من اليمين إلى اليسار">
              <Select value="ar" disabled>
                <option value="ar">العربية (RTL)</option>
              </Select>
            </Field>

            <Field label="شكل الأرقام" hint="الأرقام اللاتينية أوضح في الجداول المالية">
              <Select value={draft.digits ?? 'latn'}
                onChange={(e) => set('digits')(e.target.value as 'latn' | 'arab')}>
                <option value="latn">لاتينية (0 1 2 3)</option>
                <option value="arab">عربية هندية (٠ ١ ٢ ٣)</option>
              </Select>
            </Field>

            <div className="border-t border-line pt-4">
              <Toggle
                checked={theme === 'dark'}
                onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                label="الوضع الداكن"
                hint="مريح للعين في الإضاءة المنخفضة — يُحفظ على هذا الجهاز"
              />
            </div>

            <div className="rounded-lg bg-surface-2 p-3">
              <p className="mb-2 text-[11px] font-semibold text-muted">معاينة التنسيق</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="nums">{fmtInt(1250)} وحدة</span>
                <span className="nums">{fmtCurrency(1250.5)}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Monitor className="size-4 text-subtle" /> معلومات النظام
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat label="الإصدار" value="6.0.0" />
            <Stat label="الحساب" value={email ?? (AUTH_ENABLED ? '—' : 'وضع التطوير')} />
            <Stat label="قاعدة البيانات" value="PostgreSQL مُستضافة" />
            <Stat label="واجهة API" value={<span className="font-mono text-[11px]" dir="ltr">{API_BASE}</span>} />
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-surface-2 px-3 py-3 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              يعمل النظام على الإنترنت: تُحفظ البيانات في قاعدة بيانات PostgreSQL مُستضافة،
              وكل مؤسسة ترى بياناتها فقط. الإعدادات أعلاه تسري على مؤسستك وحدها.
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
