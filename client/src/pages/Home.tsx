import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ComponentType } from 'react';
import {
  Package, PackagePlus, PackageMinus, Tags, ArrowLeftRight,
  TriangleAlert, Settings, LayoutDashboard, FileText, Users,
  Truck, StickyNote, LogOut, SlidersHorizontal, Check, EyeOff, RotateCcw, Palette,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import { useDashboard } from '@/hooks';
import { fmtInt } from '@/lib/format';
import { Button, Modal, Toggle } from '@/components/ui';
import { NotesModal } from '@/components/NotesModal';
import { useSignOut } from '@/components/layout/SignOut';

/**
 * The launcher home.
 *
 * A grid of big, tinted, thumb-sized tiles, one per thing the operator does.
 * Everything here is a shortcut to a screen that already exists and already
 * guards itself; this only decides what to *offer*, and mirrors the roles the
 * rest of the app enforces (usePermissions) so a staff account is never shown a
 * manager's tile that would refuse it on arrival.
 *
 * Each user tailors their own grid -- which tiles show and what colour each is
 * -- with the تخصيص button. That choice lives in this browser (localStorage),
 * per person and per device; it never changes what anyone else sees and never
 * overrides a role, so it can only hide or recolour a tile the account was
 * already allowed to open.
 */

type Icon = ComponentType<{ className?: string }>;
type Tone = keyof typeof TONE;

/**
 * The tile colours. The whole tile is filled, white icon and label on top, so
 * the grid reads by hue at arm's length. 600s (700 for lime, too bright at 600
 * for white) clear contrast in both themes.
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

const TONES = Object.keys(TONE) as Tone[];

type Tile = {
  /** Stable key for saving per-tile preferences — never the label, which can change. */
  id: string;
  label: string;
  icon: Icon;
  tone: Tone;
  show: boolean;
  /** A tile is a link to a screen, or an action (like opening the notes sheet). */
  to?: string;
  onClick?: () => void;
  badge?: number;
};

/**
 * Per-tile user preference: hidden, a preset tone, or a custom colour.
 * `color` (a hex string) wins over `tone` when set, which is how the RGB picker
 * escapes the seven presets.
 */
type Pref = { hidden?: boolean; tone?: Tone; color?: string };
type Prefs = Record<string, Pref>;

const PREFS_KEY = 'inv.home_prefs';

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}
function savePrefs(prefs: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode, ignore */ }
}

export default function Home() {
  const {
    isManager, canSeeInvoiceList, canSeeDashboard, canManageUsers,
  } = usePermissions();
  const { data: stats } = useDashboard(canSeeDashboard);
  const [notesOpen, setNotesOpen] = useState(false);
  const { askToSignOut, dialog: signOutDialog } = useSignOut();

  const [customizing, setCustomizing] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  /** The tile whose colour/visibility sheet is open, while customizing. */
  const [editing, setEditing] = useState<Tile | null>(null);

  const patchPref = (id: string, patch: Pref) => {
    setPrefs((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      savePrefs(next);
      return next;
    });
  };
  const resetPrefs = () => { setPrefs({}); savePrefs({}); };

  /*
   * Long-press to customise, the way an Android home screen does it: hold
   * anywhere on the grid for ~500ms and it flips into edit mode. `pressed`
   * marks that a long-press fired so the release that follows does not also
   * open a tile -- suppressed in onClickCapture below. The تخصيص button stays
   * for discoverability and for anyone who would rather tap than hold.
   */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const startHold = () => {
    if (customizing) return;
    holdTimer.current = setTimeout(() => { pressed.current = true; setCustomizing(true); }, 500);
  };
  const cancelHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
  };
  const suppressClickAfterHold = (e: React.MouseEvent) => {
    if (pressed.current) { e.preventDefault(); e.stopPropagation(); pressed.current = false; }
  };

  // One flat list; the order runs from the daily operations down to the tools.
  const all: Tile[] = [
    { id: 'buy', label: 'شراء', icon: PackagePlus, to: '/invoices/new?type=STOCK_IN', tone: 'green', show: true },
    { id: 'sell', label: 'مبيع', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT', tone: 'red', show: true },
    { id: 'items', label: 'بحث الأصناف', icon: Package, to: '/items', tone: 'blue', show: true },
    { id: 'invoices', label: 'الفواتير', icon: FileText, to: '/invoices', tone: 'violet', show: canSeeInvoiceList },
    { id: 'movements', label: 'حركات المخزون', icon: ArrowLeftRight, to: '/movements', tone: 'blue', show: true },
    { id: 'low', label: 'نواقص المخزون', icon: TriangleAlert, to: '/reports/low-stock', tone: 'red', show: true, badge: stats?.low_stock_count },
    { id: 'categories', label: 'التصنيفات', icon: Tags, to: '/categories', tone: 'lime', show: true },
    { id: 'customers', label: 'العملاء', icon: Users, to: '/customers', tone: 'blue', show: true },
    { id: 'suppliers', label: 'الموردون', icon: Truck, to: '/suppliers', tone: 'teal', show: true },
    { id: 'dashboard', label: 'لوحة المعلومات', icon: LayoutDashboard, to: '/dashboard', tone: 'teal', show: canSeeDashboard },
    { id: 'notes', label: 'ملاحظات', icon: StickyNote, onClick: () => setNotesOpen(true), tone: 'violet', show: isManager },
    { id: 'users', label: 'المستخدمون', icon: Users, to: '/users', tone: 'blue', show: canManageUsers },
    { id: 'settings', label: 'الإعدادات', icon: Settings, to: '/settings', tone: 'slate', show: true },
    { id: 'signout', label: 'تسجيل الخروج', icon: LogOut, onClick: () => askToSignOut(), tone: 'red', show: true },
  ];

  // Role first, then the user's own preference. `permitted` is the set the
  // account may see at all; hiding only ever narrows within it.
  const permitted = all.filter((t) => t.show);
  const toneOf = (t: Tile): Tone => prefs[t.id]?.tone ?? t.tone;
  const customColor = (t: Tile) => prefs[t.id]?.color;
  const isHidden = (t: Tile) => !!prefs[t.id]?.hidden;
  // A custom colour is an inline background; otherwise the tone's utility class.
  const colorClass = (t: Tile) => (customColor(t) ? 'text-white' : TONE[toneOf(t)]);
  const colorStyle = (t: Tile) => (customColor(t) ? { backgroundColor: customColor(t) } : undefined);
  // Customizing shows everything (so a hidden tile can be brought back); the
  // normal grid shows only what is not hidden.
  const shown = customizing ? permitted : permitted.filter((t) => !isHidden(t));

  const tileClass = 'group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center shadow-sm transition active:scale-[.96] hover:brightness-105';

  const inner = (tile: Tile) => (
    <>
      {!!tile.badge && tile.badge > 0 && !customizing && (
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
      <div className="mb-3 flex items-center justify-end gap-2">
        {customizing && (
          <Button variant="ghost" onClick={resetPrefs}>
            <RotateCcw className="size-4" /> استعادة الافتراضي
          </Button>
        )}
        <Button
          variant={customizing ? 'primary' : 'secondary'}
          onClick={() => { setCustomizing((v) => !v); setEditing(null); }}
        >
          {customizing ? <><Check className="size-4" /> تم</> : <><SlidersHorizontal className="size-4" /> تخصيص</>}
        </Button>
      </div>

      <div
        className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerMove={cancelHold}
        onClickCapture={suppressClickAfterHold}
      >
        {shown.map((tile) => {
          const cls = cn(tileClass, colorClass(tile), customizing && isHidden(tile) && 'opacity-40');
          const style = colorStyle(tile);

          // Customizing: every tile is a button that opens its editor, whatever
          // it normally does, so tapping شراء here does not start an invoice.
          if (customizing) {
            return (
              <button key={tile.id} type="button" onClick={() => setEditing(tile)} className={cls} style={style}>
                {isHidden(tile) && (
                  <span className="absolute end-1.5 top-1.5 rounded-full bg-black/30 p-1">
                    <EyeOff className="size-3.5" />
                  </span>
                )}
                {inner(tile)}
              </button>
            );
          }

          return tile.to ? (
            <Link key={tile.id} to={tile.to} className={cls} style={style}>{inner(tile)}</Link>
          ) : (
            <button key={tile.id} type="button" onClick={tile.onClick} className={cls} style={style}>{inner(tile)}</button>
          );
        })}
      </div>

      {/* Per-tile editor: show/hide and colour, one tile at a time — the only
          shape that works on a phone, where a swatch row per tile in the grid
          would not fit. */}
      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          size="sm"
          title={editing.label}
          footer={<Button variant="primary" onClick={() => setEditing(null)}>تم</Button>}
        >
          <div className="space-y-4">
            <Toggle
              checked={!isHidden(editing)}
              onChange={(v) => patchPref(editing.id, { hidden: !v })}
              label="إظهار على الشاشة الرئيسية"
            />

            <div>
              <span className="mb-2 block text-sm font-medium">اللون</span>
              <div className="flex flex-wrap items-center gap-2.5">
                {TONES.map((tone) => {
                  // A preset is the choice only when no custom colour overrides it.
                  const active = !prefs[editing.id]?.color && toneOf(editing) === tone;
                  return (
                    <button
                      key={tone}
                      type="button"
                      // Picking a preset clears any custom colour.
                      onClick={() => patchPref(editing.id, { tone, color: undefined })}
                      aria-label={tone}
                      className={cn(
                        'grid size-10 place-items-center rounded-full transition',
                        TONE[tone],
                        active ? 'ring-2 ring-offset-2 ring-ink ring-offset-surface' : 'hover:scale-105',
                      )}
                    >
                      {active && <Check className="size-4" />}
                    </button>
                  );
                })}

                {/* Any colour at all — the native RGB picker. The swatch shows
                    the chosen custom colour, or a rainbow when none is set yet. */}
                <label
                  className={cn(
                    'relative grid size-10 cursor-pointer place-items-center overflow-hidden rounded-full text-white transition hover:scale-105',
                    prefs[editing.id]?.color && 'ring-2 ring-offset-2 ring-ink ring-offset-surface',
                  )}
                  style={prefs[editing.id]?.color
                    ? { backgroundColor: prefs[editing.id]?.color }
                    : { background: 'conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)' }}
                  title="لون مخصص"
                >
                  <input
                    type="color"
                    value={prefs[editing.id]?.color ?? '#0e6b64'}
                    onChange={(e) => patchPref(editing.id, { color: e.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="اختيار لون مخصص"
                  />
                  {prefs[editing.id]?.color
                    ? <Check className="size-4 drop-shadow" />
                    : <Palette className="size-4 text-white drop-shadow" />}
                </label>
              </div>
              {prefs[editing.id]?.color && (
                <p className="nums mt-2 text-xs text-muted" dir="ltr">{prefs[editing.id]?.color}</p>
              )}
            </div>
          </div>
        </Modal>
      )}

      {isManager && <NotesModal open={notesOpen} onClose={() => setNotesOpen(false)} />}
      {signOutDialog}
    </>
  );
}
