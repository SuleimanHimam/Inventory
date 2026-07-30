import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Package, PackagePlus, PackageMinus, Tags, FileSpreadsheet, TriangleAlert,
  ArrowLeftRight, ClipboardList, PlayCircle, Settings, Moon, Sun,
  ChevronUp, ChevronDown, Download, LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePrefs } from '@/store/prefs';
import { useDashboard } from '@/hooks';
import { api } from '@/lib/api';
import { toastError } from '@/store/toast';

type Icon = ComponentType<{ className?: string }>;

type Cmd = {
  label: string;
  icon: Icon;
  run: () => void;
  /** `big` renders the tall icon-over-label button used for primary actions. */
  big?: boolean;
  badge?: number;
};

type Group = { title: string; commands: Cmd[] };
type Tab = { key: string; label: string; groups: Group[] };

/** Which tab a route belongs to. Kept module-level so it is effect-stable. */
const ROUTE_TABS = [
  { key: 'stock', match: /^\/(items|categories|movements|invoices)/ },
  { key: 'count', match: /^\/(stock-counts|reports)/ },
  { key: 'tools', match: /^\/(settings|import)/ },
];

export function Ribbon() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = usePrefs();
  const { data: stats } = useDashboard();

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
          commands: [
            { label: 'إدخال', icon: PackagePlus, run: go('/invoices/new?type=STOCK_IN'), big: true },
            { label: 'إخراج', icon: PackageMinus, run: go('/invoices/new?type=STOCK_OUT'), big: true },
          ],
        },
        {
          title: 'الأصناف',
          commands: [
            { label: 'الأصناف', icon: Package, run: go('/items'), big: true },
            { label: 'صنف جديد', icon: PackagePlus, run: go('/items?new=1'), big: true },
            { label: 'التصنيفات', icon: Tags, run: go('/categories') },
          ],
        },
        {
          title: 'السجل',
          commands: [
            { label: 'الحركات', icon: ArrowLeftRight, run: go('/movements'), big: true },
            { label: 'لوحة المعلومات', icon: LayoutDashboard, run: go('/') },
          ],
        },
      ],
    },
    {
      key: 'count',
      label: 'فحص الكميات',
      groups: [
        {
          title: 'الجرد',
          commands: [
            {
              label: 'الجرد', icon: ClipboardList, run: go('/stock-counts'), big: true,
              badge: stats?.counts.open_counts,
            },
            { label: 'بدء جرد', icon: PlayCircle, run: go('/stock-counts'), big: true },
          ],
        },
        {
          title: 'تقارير',
          commands: [
            {
              label: 'نواقص المخزون', icon: TriangleAlert, run: go('/reports/low-stock'),
              big: true, badge: stats?.low_stock_count,
            },
          ],
        },
      ],
    },
    {
      key: 'tools',
      label: 'أدوات',
      groups: [
        {
          title: 'البيانات',
          commands: [
            { label: 'استيراد Excel', icon: FileSpreadsheet, run: go('/import'), big: true },
            { label: 'تنزيل القالب', icon: Download, run: template },
          ],
        },
        {
          title: 'الإعدادات',
          commands: [
            { label: 'الإعدادات', icon: Settings, run: go('/settings'), big: true },
            {
              label: theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن',
              icon: theme === 'dark' ? Sun : Moon, run: toggleTheme, big: true,
            },
          ],
        },
      ],
    },
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

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="ms-auto mb-1 rounded p-1 text-subtle transition hover:bg-surface-2 hover:text-ink"
          aria-label={collapsed ? 'إظهار الشريط' : 'إخفاء الشريط'}
          title={collapsed ? 'إظهار الشريط' : 'إخفاء الشريط'}
        >
          {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
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
          className="group relative flex w-[4.6rem] shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition hover:bg-brand-500/10"
        >
          <span className="relative grid size-8 place-items-center rounded-lg bg-brand-500/12 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white dark:text-brand-300">
            <cmd.icon className="size-[1.15rem]" />
            {!!cmd.badge && (
              <span className="nums absolute -end-1 -top-1 rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white ring-2 ring-surface-2">
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
              <cmd.icon className="size-4 shrink-0 text-brand-600 dark:text-brand-300" />
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
