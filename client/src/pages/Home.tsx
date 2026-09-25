import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import {
  Package, PackagePlus, PackageMinus, Tags, ArrowLeftRight,
  TriangleAlert, Settings, LayoutDashboard, FileText, Users,
  Truck, StickyNote, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import { useDashboard } from '@/hooks';
import { fmtInt } from '@/lib/format';
import { NotesModal } from '@/components/NotesModal';
import { useSignOut } from '@/components/layout/SignOut';

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
 * One tone per tile. The whole tile is filled with its colour now, with a
 * white icon and label on top -- so the grid reads by hue at arm's length, not
 * only by label. Assignments match the nav (stock-in/شراء green, anything that
 * removes or warns red, settings neutral). The steps are the 600s (700 for
 * lime, which is too bright at 600 for white to sit on) so white text clears
 * contrast in both themes.
 */
const TONE = {
  teal: 'bg-brand-600 text-white',
  blue: 'bg-sky-600 text-white',
  green: 'bg-emerald-600 text-white',
  red: 'bg-accent-600 text-white',
  violet: 'bg-violet-600 text-white',
  lime: 'bg-lime-700 text-white',
  slate: 'bg-slate-600 text-white',
} as const;

type Tile = {
  label: string;
  icon: Icon;
  tone: Tone;
  show: boolean;
  /** A tile is a link to a screen, or an action (like opening the notes sheet). */
  to?: string;
  onClick?: () => void;
  badge?: number;
};

export default function Home() {
  const {
    isManager, canSeeInvoiceList, canSeeDashboard, canManageUsers,
  } = usePermissions();
  const { data: stats } = useDashboard(canSeeDashboard);
  const [notesOpen, setNotesOpen] = useState(false);
  const { askToSignOut, dialog: signOutDialog } = useSignOut();

  // One flat list, no group headers -- the tiles carry their own meaning by
  // icon and colour, and the order still runs from the daily operations down
  // to the manager-only tools.
  const all: Tile[] = [
    { label: 'شراء', icon: PackagePlus, to: '/invoices/new?type=STOCK_IN', tone: 'green', show: true },
    { label: 'مبيع', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT', tone: 'red', show: true },
    { label: 'بحث الأصناف', icon: Package, to: '/items', tone: 'blue', show: true },
    { label: 'الفواتير', icon: FileText, to: '/invoices', tone: 'violet', show: canSeeInvoiceList },
    { label: 'حركات المخزون', icon: ArrowLeftRight, to: '/movements', tone: 'blue', show: true },
    { label: 'نواقص المخزون', icon: TriangleAlert, to: '/reports/low-stock', tone: 'red', show: true, badge: stats?.low_stock_count },
    { label: 'التصنيفات', icon: Tags, to: '/categories', tone: 'lime', show: true },
    { label: 'العملاء', icon: Users, to: '/customers', tone: 'blue', show: true },
    { label: 'الموردون', icon: Truck, to: '/suppliers', tone: 'teal', show: true },
    { label: 'لوحة المعلومات', icon: LayoutDashboard, to: '/dashboard', tone: 'teal', show: canSeeDashboard },
    // A manager-only private notepad. An action, not a link -- it opens a sheet
    // rather than navigating, and the API refuses /notes for anyone else.
    { label: 'ملاحظات', icon: StickyNote, onClick: () => setNotesOpen(true), tone: 'violet', show: isManager },
    { label: 'المستخدمون', icon: Users, to: '/users', tone: 'blue', show: canManageUsers },
    { label: 'الإعدادات', icon: Settings, to: '/settings', tone: 'slate', show: true },
    // Ends the grid: a sign-out that goes through the same confirm the nav uses.
    { label: 'تسجيل الخروج', icon: LogOut, onClick: () => askToSignOut(), tone: 'red', show: true },
  ];
  const tiles = all.filter((t) => t.show);

  const tileClass = cn(
    'group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center shadow-sm transition active:scale-[.96] hover:brightness-105',
  );
  const inner = (tile: Tile) => (
    <>
      {!!tile.badge && tile.badge > 0 && (
        <span className="nums absolute end-1.5 top-1.5 rounded-full bg-white px-1.5 text-[11px] font-bold leading-5 text-accent-700 shadow">
          {fmtInt(tile.badge)}
        </span>
      )}
      <tile.icon className="size-7 transition-transform group-hover:scale-110" />
      <span className="text-xs font-bold leading-tight">{tile.label}</span>
    </>
  );

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {tiles.map((tile) => (tile.to ? (
          <Link key={tile.label} to={tile.to} className={cn(tileClass, TONE[tile.tone])}>
            {inner(tile)}
          </Link>
        ) : (
          <button
            key={tile.label}
            type="button"
            onClick={tile.onClick}
            className={cn(tileClass, TONE[tile.tone])}
          >
            {inner(tile)}
          </button>
        )))}
      </div>

      {isManager && <NotesModal open={notesOpen} onClose={() => setNotesOpen(false)} />}
      {signOutDialog}
    </>
  );
}
