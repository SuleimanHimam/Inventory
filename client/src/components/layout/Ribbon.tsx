import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Package, PackagePlus, PackageMinus, Tags, FileSpreadsheet, TriangleAlert,
  ArrowLeftRight, ClipboardList, PlayCircle, Settings, Moon, Sun, FileText,
  ChevronUp, ChevronDown, Download, LayoutDashboard, User, Users, LogOut, DatabaseBackup,
} from 'lucide-react';
import { Menu, MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePrefs } from '@/store/prefs';
import { useDashboard } from '@/hooks';
import { api } from '@/lib/api';
import { toastError } from '@/store/toast';
import { AUTH_ENABLED, useSession } from '@/lib/session';
import { usePermissions } from '@/lib/permissions';
import { useSignOut } from './SignOut';

type Icon = ComponentType<{ className?: string }>;

/**
 * Command colours, matching the phone navigation's assignments (see
 * MobileNav's TONE) so the same action is the same colour on both surfaces.
 * Light mode uses 700/800 steps, dark mode 300s — the mid steps fail AA on
 * the cream page.
 */
const TONE = {
  teal: 'text-brand-700 dark:text-brand-300',
  blue: 'text-sky-700 dark:text-sky-300',
  green: 'text-emerald-700 dark:text-emerald-300',
  red: 'text-accent-600 dark:text-accent-400',
  violet: 'text-violet-700 dark:text-violet-300',
  lime: 'text-lime-800 dark:text-lime-300',
} as const;

/** The gradient tile behind a `big` command's icon, same hue as its TONE. */
const TILE: Record<keyof typeof TONE, string> = {
  teal: 'from-brand-400/30 to-brand-500/10 text-brand-700 dark:text-brand-300',
  blue: 'from-sky-400/30 to-sky-500/10 text-sky-700 dark:text-sky-300',
  green: 'from-emerald-400/30 to-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  red: 'from-accent-400/30 to-accent-500/10 text-accent-600 dark:text-accent-400',
  violet: 'from-violet-400/30 to-violet-500/10 text-violet-700 dark:text-violet-300',
  lime: 'from-lime-400/30 to-lime-500/10 text-lime-800 dark:text-lime-300',
};

type Cmd = {
  label: string;
  icon: Icon;
  run: () => void;
  /** `big` renders the tall icon-over-label button used for primary actions. */
  big?: boolean;
  badge?: number;
  tone?: keyof typeof TONE;
};

type Group = { title: string; commands: Cmd[] };
type Tab = { key: string; label: string; groups: Group[] };

/** Which tab a route belongs to. Kept module-level so it is effect-stable. */
const ROUTE_TABS = [
  { key: 'stock', match: /^\/(items|categories|movements|invoices)/ },
  { key: 'count', match: /^\/(stock-counts|reports)/ },
  { key: 'tools', match: /^\/(settings|import|users|backup)/ },
];

export function Ribbon() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = usePrefs();
  const { canImport, canManageUsers, canSeeDashboard, canWriteItems, canSeeFullNav } = usePermissions();
  const { data: stats } = useDashboard(canSeeDashboard);
  const email = useSession((s) => s.email);
  const { askToSignOut, dialog: signOutDialog } = useSignOut();

  const [active, setActive] = useState('stock');
  const [collapsed, setCollapsed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const go = (to: string) => () => navigate(to);
  const template = () =>
    api.download('/items/import/template', 'قالب-استيراد-الأصناف.xlsx')
      .catch((e) => toastError(e, 'تعذّر تنزيل القالب'));

  const tabs: Tab[] = [
    {
      key: 'stock',
      label: 'المخزون',
      groups: [
        {
          title: 'الحركة',
          // A clerk's whole job is this one button — إدخال is refused
          // outright by the API for it (requireStockOutForClerk), so it is
          // dropped here rather than left to error. `canSeeFullNav`, not
          // `isClerk`: the latter is false while the role is still loading,
          // which briefly shows this to a clerk on every reload before
          // yanking it away once `/me` answers.
          commands: [
            ...(canSeeFullNav ? [
              { label: 'إدخال', icon: PackagePlus, run: go('/invoices/new?type=STOCK_IN'), big: true, tone: 'green' as const },
            ] : []),
            { label: 'إخراج', icon: PackageMinus, run: go('/invoices/new?type=STOCK_OUT'), big: true, tone: 'red' },
          ],
        },
        {
          title: 'الأصناف',
          commands: [
            { label: 'الأصناف', icon: Package, run: go('/items'), big: true, tone: 'blue' },
            // Creating an item and browsing categories are catalogue
            // maintenance; a clerk only searches what is already there.
            ...(canWriteItems ? [
              { label: 'صنف جديد', icon: PackagePlus, run: go('/items?new=1'), big: true, tone: 'blue' as const },
              { label: 'التصنيفات', icon: Tags, run: go('/categories'), tone: 'lime' as const },
            ] : []),
          ],
        },
        {
          title: 'السجل',
          commands: [
            /*
             * The invoice register. It was reachable from the phone's "more"
             * sheet and from global search, but never from the ribbon — so on
             * desktop the only way to a saved invoice was to already be
             * looking at one. Same icon and violet tone the phone gives it,
             * per the TONE comment above.
             *
             * No draft badge, deliberately, though `stats.counts.draft_invoices`
             * is right there and two neighbouring commands carry one. This
             * screen cannot show drafts: `listInvoices` excludes them unless
             * status=DRAFT is asked for explicitly, and the status filter
             * offers only محفوظة and ملغاة. A count that lands on a list not
             * containing what it counted is worse than no count.
             */
            ...(canSeeFullNav ? [
              { label: 'الفواتير', icon: FileText, run: go('/invoices'), big: true, tone: 'violet' as const },
              { label: 'الحركات', icon: ArrowLeftRight, run: go('/movements'), big: true, tone: 'blue' as const },
            ] : []),
            // Refused for a clerk both client- and API-side — see RequireNotClerk.
            ...(canSeeFullNav ? [
              { label: 'لوحة المعلومات', icon: LayoutDashboard, run: go('/'), tone: 'teal' as const },
            ] : []),
          ],
        },
      ],
    },
    // The other two tabs are stocktaking/reports and settings/tools — every
    // destination in them is refused for a clerk, so it gets the first tab
    // alone rather than two that open onto nothing.
    ...(canSeeFullNav ? [{
      key: 'count',
      label: 'فحص الكميات',
      groups: [
        {
          title: 'الجرد',
          commands: [
            {
              label: 'الجرد', icon: ClipboardList, run: go('/stock-counts'), big: true,
              badge: stats?.counts.open_counts, tone: 'red',
            },
            { label: 'بدء جرد', icon: PlayCircle, run: go('/stock-counts'), big: true, tone: 'red' },
          ],
        },
        {
          title: 'تقارير',
          commands: [
            {
              label: 'نواقص المخزون', icon: TriangleAlert, run: go('/reports/low-stock'),
              big: true, badge: stats?.low_stock_count, tone: 'red',
            },
          ],
        },
      ],
    }] as Tab[] : []),
    // Settings, import and user admin — none of it a clerk's.
    ...(canSeeFullNav ? [{
      key: 'tools',
      label: 'أدوات',
      groups: [
        // Both commands are manager-only: the template carries the two price
        // columns, and the importer writes them. Dropping the whole group
        // rather than disabling its buttons — a greyed-out import is a
        // question the staff user cannot answer.
        ...(canImport ? [{
          title: 'البيانات',
          commands: [
            { label: 'استيراد Excel', icon: FileSpreadsheet, run: go('/import'), big: true, tone: 'green' as const },
            { label: 'تنزيل القالب', icon: Download, run: template, tone: 'violet' as const },
          ],
        }] : []),
        {
          title: 'الإعدادات',
          commands: [
            { label: 'الإعدادات', icon: Settings, run: go('/settings'), big: true, tone: 'teal' },
            ...(canManageUsers
              ? [
                { label: 'المستخدمون', icon: Users, run: go('/users'), big: true, tone: 'blue' as const },
                { label: 'النسخ الاحتياطي', icon: DatabaseBackup, run: go('/backup'), big: true, tone: 'violet' as const },
              ]
              : []),
            {
              label: theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن',
              icon: theme === 'dark' ? Sun : Moon, run: toggleTheme, big: true,
            },
          ],
        },
      ],
    }] as Tab[] : []),
  ];

  // Navigating selects the matching tab, but a manual click must stick — so
  // this syncs on route change only, rather than overriding `active` outright.
  useEffect(() => {
    const match = ROUTE_TABS.find((t) => t.match.test(location.pathname));
    if (match) setActive(match.key);
  }, [location.pathname]);

  // Auto-hide: working anywhere else on the page folds the ribbon away, and a
  // tab click brings it back.
  //
  // Deliberately `click`, not `mousedown`. Collapsing reflows the page upward,
  // so reacting to the press would move the target out from under the pointer
  // before the click resolved — the click would land on whatever slid into its
  // place. Waiting for `click` lets the intended target receive the full event
  // first; the layout shift happens after it has already been handled.
  useEffect(() => {
    if (collapsed) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Re-rendering can replace the very node that was clicked — the chevron
      // swaps ChevronUp for ChevronDown — leaving a detached target that no
      // container can `contain`. It came from inside, so ignore it.
      if (!target.isConnected) return;
      if (!rootRef.current?.contains(target)) setCollapsed(true);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCollapsed(true); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [collapsed]);

  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div ref={rootRef} className="border-b border-line bg-surface">
      <div className="flex items-end gap-0.5 px-3">
        {tabs.map((tab) => {
          const isActive = tab.key === current.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => { setActive(tab.key); setCollapsed(false); }}
              className={cn(
                'relative -mb-px rounded-t-lg px-4 py-2 text-[13px] font-semibold transition',
                isActive
                  ? 'bg-surface-2 text-brand-600 dark:text-brand-300'
                  : 'text-muted hover:bg-surface-2/60 hover:text-ink',
              )}
            >
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-3 top-0 h-[2.5px] rounded-b-full bg-brand-600" />
              )}
            </button>
          );
        })}

        <div className="ms-auto mb-1 flex items-center gap-1">
          {AUTH_ENABLED && (
            <Menu
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
                >
                  <User className="size-3.5" />
                  <span className="max-w-[9rem] truncate">{email ?? 'حسابي'}</span>
                  <ChevronDown className={cn('size-3 opacity-70 transition-transform', open && 'rotate-180')} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="border-b border-line px-2.5 pb-1.5 pt-1">
                    <p className="truncate text-[11px] text-subtle">مسجّل الدخول بحساب</p>
                    <p className="truncate text-sm font-semibold text-ink">{email}</p>
                  </div>
                  <MenuItem
                    onClick={() => { close(); askToSignOut(); }}
                    icon={<LogOut className="size-4" />}
                    className="mt-1 text-accent-600 dark:text-accent-400"
                  >
                    تسجيل الخروج
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="rounded p-1 text-subtle transition hover:bg-surface-2 hover:text-ink"
            aria-label={collapsed ? 'إظهار الشريط' : 'إخفاء الشريط'}
            title={collapsed ? 'إظهار الشريط' : 'إخفاء الشريط'}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex items-stretch gap-0 overflow-x-auto bg-surface-2 px-3 py-1.5">
          {current.groups.map((group, index) => (
            <div key={group.title} className="flex items-stretch">
              {index > 0 && <span aria-hidden className="my-2 mx-1 w-px shrink-0 bg-line" />}
              <div className="flex flex-col">
                <div className="flex flex-1 items-start gap-1 px-1.5 pt-1">
                  <BigCommands commands={group.commands.filter((c) => c.big)} />
                  <SmallCommands commands={group.commands.filter((c) => !c.big)} />
                </div>
                <p className="px-2 pb-0.5 pt-1 text-center text-[10px] text-subtle">{group.title}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {signOutDialog}
    </div>
  );
}

function BigCommands({ commands }: { commands: Cmd[] }) {
  return (
    <>
      {commands.map((cmd) => (
        <button
          key={cmd.label}
          type="button"
          onClick={cmd.run}
          title={cmd.label}
          className="group relative flex w-[4.6rem] shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition hover:bg-surface-3"
        >
          <span className={cn(
            'relative grid size-9 place-items-center rounded-xl bg-gradient-to-br shadow-sm transition',
            'group-hover:scale-105 group-active:scale-95',
            TILE[cmd.tone ?? 'teal'],
          )}>
            <cmd.icon className="size-[1.15rem]" />
            {!!cmd.badge && (
              <span className="nums absolute -end-1 -top-1 rounded-full bg-accent-600 px-1 text-[9px] font-bold leading-4 text-white ring-2 ring-surface-2">
                {cmd.badge}
              </span>
            )}
          </span>
          <span className="text-center text-[11px] font-medium leading-tight text-ink">
            {cmd.label}
          </span>
        </button>
      ))}
    </>
  );
}

/** Compact rows, stacked three-per-column like a classic ribbon. */
function SmallCommands({ commands }: { commands: Cmd[] }) {
  if (!commands.length) return null;
  const columns: Cmd[][] = [];
  for (let i = 0; i < commands.length; i += 3) columns.push(commands.slice(i, i + 3));

  return (
    <>
      {columns.map((column, index) => (
        <div key={index} className="flex shrink-0 flex-col gap-0.5">
          {column.map((cmd) => (
            <button
              key={cmd.label}
              type="button"
              onClick={cmd.run}
              title={cmd.label}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11.5px] text-ink transition hover:bg-brand-500/10"
            >
              <cmd.icon className={cn('size-4 shrink-0', TONE[cmd.tone ?? 'teal'])} />
              <span className="whitespace-nowrap">{cmd.label}</span>
              {!!cmd.badge && (
                <span className="nums rounded-full bg-brand-600 px-1.5 text-[9px] font-bold leading-4 text-white">
                  {cmd.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
