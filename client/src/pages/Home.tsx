import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import {
  Package, PackagePlus, PackageMinus, ClipboardList, Tags, ArrowLeftRight,
  TriangleAlert, FileSpreadsheet, Settings, LayoutDashboard, FileText, Users,
  Truck, FolderOpen, DatabaseBackup, ChevronLeft,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import { useDashboard, useSettings } from '@/hooks';
import { useSession } from '@/lib/session';
import { fmtInt } from '@/lib/format';

/**
 * The launcher home.
 *
 * A phone and a tablet are used standing at a counter, one hand, glancing --
 * not the place for a wall of charts. So the landing is a grid of big, tinted,
 * thumb-sized tiles, one per thing the operator actually does, and the numbers
 * that used to fill this screen are compressed into a single strip at the top
 * with the full dashboard one tap away.
 *
 * Everything here is a shortcut to a screen that already exists and already
 * guards itself; this only decides what to *offer*. It mirrors the roles the
 * rest of the app enforces (usePermissions) so a staff account is not shown a
 * manager's tile that would refuse it on arrival -- a blank wall is a worse
 * answer than never offering the door. A clerk never reaches this page at all:
 * RequireNotClerk sends it straight to stock-out entry, its whole job.
 *
 * Colours and icons are deliberately the same ones the bottom nav and the
 * ribbon use, so a tile and its nav entry are recognisably the same door.
 */

type Icon = ComponentType<{ className?: string }>;
type Tone = keyof typeof TONE;

/**
 * One tone per tile, so the grid is legible by hue as well as label -- the
 * same assignments as the nav (stock-in green, anything that removes or warns
 * red, settings neutral), kept in step on purpose. Light mode uses the darker
 * steps and dark mode the lighter ones, the pairing that clears AA on the
 * cream page.
 */
const TONE = {
  teal: { text: 'text-brand-700 dark:text-brand-300', bg: 'bg-brand-500/12' },
  blue: { text: 'text-sky-700 dark:text-sky-300', bg: 'bg-sky-500/12' },
  green: { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/12' },
  red: { text: 'text-accent-600 dark:text-accent-400', bg: 'bg-accent-500/12' },
  violet: { text: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-500/12' },
  lime: { text: 'text-lime-800 dark:text-lime-300', bg: 'bg-lime-500/15' },
  slate: { text: 'text-muted', bg: 'bg-surface-3' },
} as const;

type Tile = {
  label: string;
  hint: string;
  icon: Icon;
  to: string;
  tone: Tone;
  show: boolean;
  badge?: number;
};

type Section = { title: string; tiles: Tile[] };

export default function Home() {
  const {
    isManager, canSeeInvoiceList, canSeeDashboard, canImport, canManageUsers,
  } = usePermissions();
  const { data: settings } = useSettings();
  const { data: stats } = useDashboard(canSeeDashboard);
  const email = useSession((s) => s.email);

  const company = settings?.company_name?.trim() || 'مخزوني';

  const sections: Section[] = [
    {
      title: 'عمليات سريعة',
      tiles: [
        { label: 'إدخال بضاعة', hint: 'فاتورة دخول جديدة', icon: PackagePlus, to: '/invoices/new?type=STOCK_IN', tone: 'green', show: true },
        { label: 'إخراج بضاعة', hint: 'فاتورة إخراج جديدة', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT', tone: 'red', show: true },
        { label: 'بحث الأصناف', hint: 'الكتالوج والأرصدة', icon: Package, to: '/items', tone: 'blue', show: true },
      ],
    },
    {
      title: 'المخزون والتقارير',
      tiles: [
        { label: 'الفواتير', hint: 'دخول وإخراج', icon: FileText, to: '/invoices', tone: 'violet', show: canSeeInvoiceList },
        { label: 'الجرد', hint: 'فحص الكميات', icon: ClipboardList, to: '/stock-counts', tone: 'red', show: true, badge: stats?.counts.open_counts },
        { label: 'حركات المخزون', hint: 'سجل كل حركة', icon: ArrowLeftRight, to: '/movements', tone: 'blue', show: true },
        { label: 'نواقص المخزون', hint: 'ما اقترب من النفاد', icon: TriangleAlert, to: '/reports/low-stock', tone: 'red', show: true, badge: stats?.low_stock_count },
        { label: 'التصنيفات', hint: 'تنظيم الأصناف', icon: Tags, to: '/categories', tone: 'lime', show: true },
        { label: 'لوحة المعلومات', hint: 'الإحصائيات والرسوم', icon: LayoutDashboard, to: '/dashboard', tone: 'teal', show: canSeeDashboard },
      ],
    },
    {
      title: 'الجهات',
      tiles: [
        { label: 'العملاء', hint: 'كشوف الحساب', icon: Users, to: '/customers', tone: 'blue', show: true },
        { label: 'الموردون', hint: 'كشوف الحساب', icon: Truck, to: '/suppliers', tone: 'teal', show: true },
      ],
    },
    {
      title: 'النظام',
      tiles: [
        { label: 'استيراد Excel', hint: 'إضافة أصناف دفعة', icon: FileSpreadsheet, to: '/import', tone: 'green', show: canImport },
        { label: 'المستخدمون', hint: 'الحسابات والصلاحيات', icon: Users, to: '/users', tone: 'blue', show: canManageUsers },
        { label: 'الملفات', hint: 'منشآت مستقلة', icon: FolderOpen, to: '/files', tone: 'teal', show: canManageUsers },
        { label: 'النسخ الاحتياطي', hint: 'حفظ واسترجاع', icon: DatabaseBackup, to: '/backup', tone: 'violet', show: canManageUsers },
        { label: 'الإعدادات', hint: 'العملة والأرقام والاسم', icon: Settings, to: '/settings', tone: 'slate', show: true },
      ],
    },
  ];

  const visible = sections
    .map((s) => ({ ...s, tiles: s.tiles.filter((t) => t.show) }))
    .filter((s) => s.tiles.length > 0);

  const summary = [
    { label: 'الأصناف', value: stats?.total_items },
    { label: 'الوحدات', value: stats?.total_units },
    { label: 'نواقص', value: stats?.low_stock_count, alert: true },
    { label: 'جرد مفتوح', value: stats?.counts.open_counts, alert: true },
  ].filter((s) => s.value != null);

  return (
    <div className="space-y-6">
      {/* Hero. The reference's dead "choose a customer" banner, turned into
          something that earns its height: who you are, which file you are in,
          and the four numbers worth a glance -- the rest is one tap into the
          dashboard. */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white sm:p-7">
        <div className="pointer-events-none absolute -end-16 -top-20 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 -start-10 size-72 rounded-full bg-black/10 blur-2xl" aria-hidden />

        <div className="relative">
          <p className="text-xs text-white/70">أهلاً بك في</p>
          <h1 className="mt-0.5 text-2xl font-bold leading-tight sm:text-3xl">{company}</h1>
          {email && (
            <p className="mt-1 truncate text-xs text-white/70">
              الحساب: <span className="font-medium text-white/90">{email}</span>
            </p>
          )}

          {summary.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
              {summary.map((s) => (
                <div key={s.label} className="rounded-2xl bg-white/10 px-3 py-2 backdrop-blur-sm sm:min-w-[7rem]">
                  <p className="text-[11px] text-white/70">{s.label}</p>
                  <p className={cn('nums text-lg font-bold', s.alert && Number(s.value) > 0 && 'text-amber-200')}>
                    {fmtInt(Number(s.value))}
                  </p>
                </div>
              ))}
              {canSeeDashboard && (
                <Link
                  to="/dashboard"
                  className="col-span-2 flex items-center justify-center gap-1 rounded-2xl bg-white/15 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/25 sm:col-span-1 sm:min-w-[7rem]"
                >
                  التفاصيل <ChevronLeft className="size-4" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* The tiles. Two columns on a phone, widening with the screen -- big
          enough to hit without looking, which is the whole point of a launcher
          over a menu. */}
      {visible.map((section) => (
        <section key={section.title}>
          <h2 className="mb-2.5 px-1 text-sm font-bold text-muted">{section.title}</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {section.tiles.map((tile) => (
              <Link
                key={tile.to}
                to={tile.to}
                className="card group relative flex flex-col items-center gap-2.5 rounded-2xl p-4 text-center transition active:scale-[.97] sm:p-5"
              >
                {!!tile.badge && tile.badge > 0 && (
                  <span className="nums absolute end-2.5 top-2.5 rounded-full bg-accent-600 px-1.5 text-[11px] font-bold leading-5 text-white">
                    {fmtInt(tile.badge)}
                  </span>
                )}
                <span className={cn(
                  'grid size-14 place-items-center rounded-2xl transition-transform group-hover:scale-105',
                  TONE[tile.tone].bg, TONE[tile.tone].text,
                )}>
                  <tile.icon className="size-7" />
                </span>
                <span className="text-sm font-bold leading-tight">{tile.label}</span>
                <span className="text-[11px] leading-snug text-subtle">{tile.hint}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {isManager && (
        <p className="px-1 text-center text-[11px] text-subtle">
          كل الأقسام متاحة أيضاً من الشريط العلوي وقائمة «المزيد».
        </p>
      )}
    </div>
  );
}
