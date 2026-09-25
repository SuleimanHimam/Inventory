import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import {
  Package, PackagePlus, PackageMinus, ClipboardList, Tags, ArrowLeftRight,
  TriangleAlert, FileSpreadsheet, Settings, LayoutDashboard, FileText, Users,
  Truck, FolderOpen, DatabaseBackup,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import { useDashboard } from '@/hooks';
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

export default function Home() {
  const {
    canSeeInvoiceList, canSeeDashboard, canImport, canManageUsers,
  } = usePermissions();
  const { data: stats } = useDashboard(canSeeDashboard);

  // One flat list, no group headers -- the tiles carry their own meaning by
  // icon and colour, and the order still runs from the daily operations down
  // to the manager-only tools.
  const all: Tile[] = [
    { label: 'إدخال بضاعة', hint: 'فاتورة دخول جديدة', icon: PackagePlus, to: '/invoices/new?type=STOCK_IN', tone: 'green', show: true },
    { label: 'إخراج بضاعة', hint: 'فاتورة إخراج جديدة', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT', tone: 'red', show: true },
    { label: 'بحث الأصناف', hint: 'الكتالوج والأرصدة', icon: Package, to: '/items', tone: 'blue', show: true },
    { label: 'الفواتير', hint: 'دخول وإخراج', icon: FileText, to: '/invoices', tone: 'violet', show: canSeeInvoiceList },
    { label: 'الجرد', hint: 'فحص الكميات', icon: ClipboardList, to: '/stock-counts', tone: 'red', show: true, badge: stats?.counts.open_counts },
    { label: 'حركات المخزون', hint: 'سجل كل حركة', icon: ArrowLeftRight, to: '/movements', tone: 'blue', show: true },
    { label: 'نواقص المخزون', hint: 'ما اقترب من النفاد', icon: TriangleAlert, to: '/reports/low-stock', tone: 'red', show: true, badge: stats?.low_stock_count },
    { label: 'التصنيفات', hint: 'تنظيم الأصناف', icon: Tags, to: '/categories', tone: 'lime', show: true },
    { label: 'العملاء', hint: 'كشوف الحساب', icon: Users, to: '/customers', tone: 'blue', show: true },
    { label: 'الموردون', hint: 'كشوف الحساب', icon: Truck, to: '/suppliers', tone: 'teal', show: true },
    { label: 'لوحة المعلومات', hint: 'الإحصائيات والرسوم', icon: LayoutDashboard, to: '/dashboard', tone: 'teal', show: canSeeDashboard },
    { label: 'استيراد Excel', hint: 'إضافة أصناف دفعة', icon: FileSpreadsheet, to: '/import', tone: 'green', show: canImport },
    { label: 'المستخدمون', hint: 'الحسابات والصلاحيات', icon: Users, to: '/users', tone: 'blue', show: canManageUsers },
    { label: 'الملفات', hint: 'منشآت مستقلة', icon: FolderOpen, to: '/files', tone: 'teal', show: canManageUsers },
    { label: 'النسخ الاحتياطي', hint: 'حفظ واسترجاع', icon: DatabaseBackup, to: '/backup', tone: 'violet', show: canManageUsers },
    { label: 'الإعدادات', hint: 'العملة والأرقام والاسم', icon: Settings, to: '/settings', tone: 'slate', show: true },
  ];
  const tiles = all.filter((t) => t.show);

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {tiles.map((tile) => (
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
  );
}
