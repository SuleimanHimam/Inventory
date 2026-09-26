import { useEffect, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import {
  Package, PackagePlus, PackageMinus, Tags, ArrowLeftRight,
  TriangleAlert, Settings, LayoutDashboard, FileText, Users,
  Truck, StickyNote, LogOut, Check, EyeOff, RotateCcw, BookOpen,
  ArrowDownCircle, ArrowUpCircle, Wallet, Scale, ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/permissions';
import { useDashboard } from '@/hooks';
import { Button, Modal, Toggle } from '@/components/ui';
import { signOut } from '@/lib/session';

/**
 * The home launcher's tiles, their colours, and the per-user customization of
 * both — shared between the Home screen (which renders the grid) and the
 * Settings screen (which now hosts the "customize the home page" tab). Kept in
 * one place so the tile list and the editor never drift apart.
 *
 * Each user tailors their own grid — which tiles show, and the colour of each —
 * and that choice lives in this browser (localStorage), per person and per
 * device. It never changes what anyone else sees and never overrides a role: it
 * can only hide or recolour a tile the account was already allowed to open.
 */
type Icon = ComponentType<{ className?: string }>;
export type Tone = keyof typeof TONE;

/**
 * The tile colours. The whole tile is filled, white icon and label on top, so
 * the grid reads by hue at arm's length.
 */
export const TONE = {
  teal: 'bg-brand-600 text-white',
  blue: 'bg-sky-600 text-white',
  green: 'bg-emerald-600 text-white',
  red: 'bg-accent-600 text-white',
  violet: 'bg-violet-600 text-white',
  lime: 'bg-lime-700 text-white',
  slate: 'bg-slate-600 text-white',
} as const;

export const TONES = Object.keys(TONE) as Tone[];

/** A hex per preset, the starting point when the RGB picker opens on a tile. */
export const TONE_HEX: Record<Tone, string> = {
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
 * gradient RGB sliders whose tracks recolour as the other channels move.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
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

export type Tile = {
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
export type Pref = { hidden?: boolean; tone?: Tone; color?: string; fg?: string };
export type Prefs = Record<string, Pref>;

const PREFS_KEY = 'inv.home_prefs';

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}
export function savePrefs(prefs: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode, ignore */ }
}

/**
 * The tiles this account is allowed to see, in display order. Actions (opening
 * the notes sheet) are passed in; everything else is a link or sign-out.
 */
export function useHomeTiles({ onNotes }: { onNotes?: () => void } = {}): Tile[] {
  const {
    isManager, canSeeInvoiceList, canSeeDashboard, canManageUsers, canSeeFullNav,
  } = usePermissions();
  const { data: stats } = useDashboard(canSeeDashboard);

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
    { id: 'receipt', label: 'سند قبض', icon: ArrowDownCircle, to: '/vouchers/new?type=RECEIPT', tone: 'green', show: isManager },
    { id: 'payment', label: 'سند صرف', icon: ArrowUpCircle, to: '/vouchers/new?type=PAYMENT', tone: 'red', show: isManager },
    { id: 'vouchers', label: 'السندات', icon: FileText, to: '/vouchers', tone: 'teal', show: isManager },
    { id: 'expenses', label: 'مصروف سريع', icon: Wallet, to: '/expenses', tone: 'red', show: isManager },
    { id: 'accounting', label: 'المحاسبة', icon: Scale, to: '/accounting', tone: 'teal', show: isManager },
    { id: 'statement', label: 'كشف حساب', icon: ScrollText, to: '/statement', tone: 'violet', show: isManager },
    { id: 'notes', label: 'ملاحظات', icon: StickyNote, onClick: onNotes, tone: 'violet', show: isManager },
    { id: 'users', label: 'المستخدمون', icon: Users, to: '/users', tone: 'blue', show: canManageUsers },
    { id: 'settings', label: 'الإعدادات', icon: Settings, to: '/settings', tone: 'slate', show: canSeeFullNav },
    { id: 'signout', label: 'تسجيل الخروج', icon: LogOut, onClick: () => signOut(), tone: 'red', show: true },
  ];
  return all.filter((t) => t.show);
}

const tileClass = 'group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center shadow-sm transition active:scale-[.96] hover:brightness-105';

/**
 * The customize view: every permitted tile as a button that opens its editor
 * (show/hide, preset tone, or a custom colour). Lives on the Settings screen.
 * Reads and writes the same localStorage prefs the Home grid renders from, so
 * changes appear the next time Home is opened.
 */
export function HomeCustomizer() {
  const tiles = useHomeTiles();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [editing, setEditing] = useState<Tile | null>(null);

  const patchPref = (id: string, patch: Pref) => {
    setPrefs((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      savePrefs(next);
      return next;
    });
  };
  const resetPrefs = () => { setPrefs({}); savePrefs({}); };
  const resetTile = (id: string) => setPrefs((prev) => {
    const next = { ...prev };
    delete next[id];
    savePrefs(next);
    return next;
  });

  const toneOf = (t: Tile): Tone => prefs[t.id]?.tone ?? t.tone;
  const customColor = (t: Tile) => prefs[t.id]?.color;
  const customFg = (t: Tile) => prefs[t.id]?.fg;
  const isHidden = (t: Tile) => !!prefs[t.id]?.hidden;
  const colorClass = (t: Tile) => (customColor(t) ? 'text-white' : TONE[toneOf(t)]);
  const colorStyle = (t: Tile) => {
    const st: CSSProperties = {};
    if (customColor(t)) st.backgroundColor = customColor(t);
    if (customFg(t)) st.color = customFg(t);
    return Object.keys(st).length ? st : undefined;
  };

  const inner = (tile: Tile) => (
    <>
      <tile.icon className="size-7 transition-transform group-hover:scale-110" />
      <span className="text-xs font-bold leading-tight">{tile.label}</span>
    </>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-muted">
          اضغط أي زر لإظهاره أو إخفائه وتغيير لونه. يُحفظ على هذا الجهاز لك وحدك.
        </p>
        <Button variant="ghost" size="sm" onClick={resetPrefs}>
          <RotateCcw className="size-4" /> استعادة الافتراضي
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            onClick={() => setEditing(tile)}
            className={cn(tileClass, colorClass(tile), isHidden(tile) && 'opacity-40')}
            style={colorStyle(tile)}
          >
            {isHidden(tile) && (
              <span className="absolute end-1.5 top-1.5 rounded-full bg-black/30 p-1">
                <EyeOff className="size-3.5" />
              </span>
            )}
            {inner(tile)}
          </button>
        ))}
      </div>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          size="sm"
          title={editing.label}
          footer={<Button variant="primary" onClick={() => setEditing(null)}>تم</Button>}
        >
          <div className="space-y-5">
            <Toggle
              checked={!isHidden(editing)}
              onChange={(v) => patchPref(editing.id, { hidden: !v })}
              label="إظهار على الشاشة الرئيسية"
            />

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

            <Button variant="ghost" className="w-full" onClick={() => resetTile(editing.id)}>
              <RotateCcw className="size-4" /> إعادة هذا الزر إلى ألوانه الافتراضية
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
