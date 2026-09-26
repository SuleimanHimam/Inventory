import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ComponentType, CSSProperties } from 'react';
import {
  Package, PackagePlus, PackageMinus, Tags, ArrowLeftRight,
  TriangleAlert, Settings, LayoutDashboard, FileText, Users,
  Truck, StickyNote, LogOut, SlidersHorizontal, Check, EyeOff, RotateCcw, BookOpen,
  ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import { useDashboard } from '@/hooks';
import { fmtInt } from '@/lib/format';
import { Button, Modal, Toggle } from '@/components/ui';
import { NotesModal } from '@/components/NotesModal';
import { signOut } from '@/lib/session';

/**
 * The launcher home.
 *
 * A grid of big, tinted, thumb-sized tiles, one per thing the operator does.
 * Everything here is a shortcut to a screen that already exists and already
 * guards itself; this only decides what to *offer*, and mirrors the roles the
 * rest of the app enforces (usePermissions) so no account is shown a tile it
 * may not open: a clerk lands here too and sees just مبيع, بحث الأصناف and
 * sign-out, a staff account sees the daily work without the manager tools, and
 * a manager sees everything.
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

/** A hex per preset, the starting point when the RGB picker opens on a tile
 *  that has only ever used a preset tone. Approximate, not exact — the moment
 *  the user drags, it becomes their own custom colour anyway. */
const TONE_HEX: Record<Tone, string> = {
  teal: '#0f766e', blue: '#0284c7', green: '#059669', red: '#e11d48',
  violet: '#7c3aed', lime: '#4d7c0f', slate: '#475569',
};

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x0f766e;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
/** Perceived brightness (0–1), for choosing black vs white text over a colour. */
const luminance = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/**
 * A small modern colour picker: a live preview with an editable hex, and three
 * gradient RGB sliders whose tracks recolour as the other channels move. Built
 * in-house rather than leaning on the bare native swatch so it reads as part of
 * the app, works the same on every device, and shows the value as it changes.
 */
function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const { r, g, b } = hexToRgb(value);
  const [hexText, setHexText] = useState(value);
  useEffect(() => setHexText(value), [value]);

  const onHex = (t: string) => {
    setHexText(t);
    const v = t.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) onChange(v.startsWith('#') ? v : `#${v}`);
  };

  const light = luminance(r, g, b) > 0.6;
  const channels: Array<{ key: 'r' | 'g' | 'b'; label: string; val: number; track: string }> = [
    { key: 'r', label: 'R', val: r, track: `linear-gradient(to right, rgb(0,${g},${b}), rgb(255,${g},${b}))` },
    { key: 'g', label: 'G', val: g, track: `linear-gradient(to right, rgb(${r},0,${b}), rgb(${r},255,${b}))` },
    { key: 'b', label: 'B', val: b, track: `linear-gradient(to right, rgb(${r},${g},0), rgb(${r},${g},255))` },
  ];
  const setChannel = (key: 'r' | 'g' | 'b', v: number) =>
    onChange(rgbToHex(key === 'r' ? v : r, key === 'g' ? v : g, key === 'b' ? v : b));

  return (
    <div className="space-y-3">
      <div
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 shadow-inner ring-1 ring-black/5"
        style={{ backgroundColor: value }}
      >
        <span className={cn('text-sm font-bold', light ? 'text-black/70' : 'text-white')}>معاينة</span>
        <input
          value={hexText}
          onChange={(e) => onHex(e.target.value)}
          dir="ltr"
          maxLength={7}
          aria-label="القيمة السداسية للّون"
          className={cn(
            'nums ms-auto w-24 rounded-lg border-0 bg-white/25 px-2 py-1 text-center text-sm font-bold outline-none ring-1 ring-white/30 focus:ring-2',
            light ? 'text-black placeholder-black/40' : 'text-white placeholder-white/60',
          )}
        />
      </div>

      <div className="space-y-2.5">
        {channels.map((c) => (
          <div key={c.key} className="flex items-center gap-2.5">
            <span className="w-4 text-center text-xs font-bold text-muted">{c.label}</span>
            <input
              type="range"
              min="0"
              max="255"
              value={c.val}
              onChange={(e) => setChannel(c.key, Number(e.target.value))}
              className="colorslider h-2.5 flex-1 cursor-pointer appearance-none rounded-full"
              style={{ background: c.track }}
              aria-label={c.label}
            />
            <span className="nums w-8 text-end text-xs text-muted">{c.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
type Pref = { hidden?: boolean; tone?: Tone; color?: string; fg?: string };
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
    isManager, canSeeInvoiceList, canSeeDashboard, canManageUsers, canSeeFullNav,
  } = usePermissions();
  const { data: stats } = useDashboard(canSeeDashboard);
  const [notesOpen, setNotesOpen] = useState(false);

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

  // One flat list; the order runs from the daily operations down to the tools.
  const all: Tile[] = [
    { id: 'buy', label: 'شراء', icon: PackagePlus, to: '/invoices/new?type=STOCK_IN', tone: 'green', show: canSeeFullNav },
    { id: 'sell', label: 'مبيع', icon: PackageMinus, to: '/invoices/new?type=STOCK_OUT', tone: 'red', show: true },
    { id: 'items', label: 'بحث الأصناف', icon: Package, to: '/items', tone: 'blue', show: true },
    { id: 'invoices', label: 'الفواتير', icon: FileText, to: '/invoices', tone: 'violet', show: canSeeInvoiceList },
    { id: 'movements', label: 'حركات المخزون', icon: ArrowLeftRight, to: '/movements', tone: 'blue', show: canSeeFullNav },
    { id: 'low', label: 'نواقص المخزون', icon: TriangleAlert, to: '/reports/low-stock', tone: 'red', show: canSeeFullNav, badge: stats?.low_stock_count },
    { id: 'categories', label: 'التصنيفات', icon: Tags, to: '/categories', tone: 'lime', show: canSeeFullNav },
    { id: 'customers', label: 'العملاء', icon: Users, to: '/customers', tone: 'blue', show: canSeeFullNav },
    { id: 'suppliers', label: 'الموردون', icon: Truck, to: '/suppliers', tone: 'teal', show: canSeeFullNav },
    { id: 'dashboard', label: 'لوحة المعلومات', icon: LayoutDashboard, to: '/dashboard', tone: 'teal', show: canSeeDashboard },
    { id: 'accounts', label: 'دليل الحسابات', icon: BookOpen, to: '/accounts', tone: 'violet', show: canSeeFullNav },
    { id: 'receipt', label: 'سند قبض', icon: ArrowDownCircle, to: '/vouchers?new=RECEIPT', tone: 'green', show: isManager },
    { id: 'payment', label: 'سند صرف', icon: ArrowUpCircle, to: '/vouchers?new=PAYMENT', tone: 'red', show: isManager },
    { id: 'vouchers', label: 'السندات', icon: FileText, to: '/vouchers', tone: 'teal', show: isManager },
    { id: 'notes', label: 'ملاحظات', icon: StickyNote, onClick: () => setNotesOpen(true), tone: 'violet', show: isManager },
    { id: 'users', label: 'المستخدمون', icon: Users, to: '/users', tone: 'blue', show: canManageUsers },
    { id: 'settings', label: 'الإعدادات', icon: Settings, to: '/settings', tone: 'slate', show: canSeeFullNav },
    { id: 'signout', label: 'تسجيل الخروج', icon: LogOut, onClick: () => signOut(), tone: 'red', show: true },
  ];

  // Role first, then the user's own preference. `permitted` is the set the
  // account may see at all; hiding only ever narrows within it.
  const permitted = all.filter((t) => t.show);
  const toneOf = (t: Tile): Tone => prefs[t.id]?.tone ?? t.tone;
  const customColor = (t: Tile) => prefs[t.id]?.color;
  const customFg = (t: Tile) => prefs[t.id]?.fg;
  const isHidden = (t: Tile) => !!prefs[t.id]?.hidden;
  // A custom colour is an inline background; otherwise the tone's utility class.
  // Background is the tone class unless a custom colour replaces it; a custom
  // foreground (icon + text, via currentColor) overrides the tone's white.
  const colorClass = (t: Tile) => (customColor(t) ? 'text-white' : TONE[toneOf(t)]);
  const colorStyle = (t: Tile) => {
    const st: CSSProperties = {};
    if (customColor(t)) st.backgroundColor = customColor(t);
    if (customFg(t)) st.color = customFg(t);
    return Object.keys(st).length ? st : undefined;
  };
  const resetTile = (id: string) => setPrefs((prev) => {
    const next = { ...prev };
    delete next[id];
    savePrefs(next);
    return next;
  });
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

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
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
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <Toggle
                checked={!isHidden(editing)}
                onChange={(v) => patchPref(editing.id, { hidden: !v })}
                label="إظهار على الشاشة الرئيسية"
              />
            </div>

            {/* Live preview of this tile with the current choices. */}
            <div className="flex justify-center">
              <div
                className={cn(
                  'flex aspect-square w-28 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center shadow-sm',
                  colorClass(editing),
                )}
                style={colorStyle(editing)}
              >
                <editing.icon className="size-7" />
                <span className="text-xs font-bold leading-tight">{editing.label}</span>
              </div>
            </div>

            {/* Background: quick presets, then the full picker. */}
            <div>
              <span className="mb-2 block text-sm font-medium">لون الخلفية</span>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {TONES.map((tone) => {
                  const active = !prefs[editing.id]?.color && toneOf(editing) === tone;
                  return (
                    <button
                      key={tone}
                      type="button"
                      onClick={() => patchPref(editing.id, { tone, color: undefined })}
                      aria-label={tone}
                      className={cn(
                        'grid size-9 place-items-center rounded-full transition',
                        TONE[tone],
                        active ? 'ring-2 ring-offset-2 ring-ink ring-offset-surface' : 'hover:scale-105',
                      )}
                    >
                      {active && <Check className="size-4" />}
                    </button>
                  );
                })}
              </div>
              <ColorPicker
                value={prefs[editing.id]?.color ?? TONE_HEX[toneOf(editing)]}
                onChange={(hex) => patchPref(editing.id, { color: hex })}
              />
            </div>

            {/* Foreground: the icon and label colour. White by default. */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium">لون الأيقونة والنص</span>
                <button
                  type="button"
                  onClick={() => patchPref(editing.id, { fg: '#ffffff' })}
                  className="grid size-6 place-items-center rounded-full bg-white ring-1 ring-line"
                  aria-label="أبيض"
                  title="أبيض"
                >
                  {(prefs[editing.id]?.fg ?? '#ffffff').toLowerCase() === '#ffffff' && (
                    <Check className="size-3.5 text-slate-700" />
                  )}
                </button>
              </div>
              <ColorPicker
                value={prefs[editing.id]?.fg ?? '#ffffff'}
                onChange={(hex) => patchPref(editing.id, { fg: hex })}
              />
            </div>

            {/* Back to this one button's designed colours, without touching the rest. */}
            <Button variant="ghost" className="w-full" onClick={() => resetTile(editing.id)}>
              <RotateCcw className="size-4" /> إعادة هذا الزر إلى ألوانه الافتراضية
            </Button>
          </div>
        </Modal>
      )}

      {isManager && <NotesModal open={notesOpen} onClose={() => setNotesOpen(false)} />}
    </>
  );
}
