import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Package, Tags, ArrowLeftRight, ClipboardList, Users, Truck,
  FileText, FileSpreadsheet, TriangleAlert, Settings, Boxes,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDashboard } from '@/hooks';

type NavItem = {
  to: string;
  label: string;
  icon: typeof Package;
  badge?: number;
  end?: boolean;
};

/**
 * Primary navigation, laid out horizontally in the header.
 *
 * Items keep the same grouping the sidebar used — a thin divider stands in for
 * the group headings, which have no room in a single row.
 */
export function NavBar() {
  const { data: stats } = useDashboard();
  const { t } = useTranslation();

  const groups: NavItem[][] = [
    [
      { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, end: true },
      { to: '/items', label: t('nav.items'), icon: Package },
      { to: '/categories', label: t('nav.categories'), icon: Tags },
    ],
    [
      { to: '/invoices', label: t('nav.invoices'), icon: FileText, badge: stats?.counts.draft_invoices },
      { to: '/movements', label: t('nav.movements'), icon: ArrowLeftRight },
      { to: '/stock-counts', label: t('nav.stockCounts'), icon: ClipboardList, badge: stats?.counts.open_counts },
    ],
    [
      { to: '/customers', label: t('nav.customers'), icon: Users },
      { to: '/suppliers', label: t('nav.suppliers'), icon: Truck },
    ],
    [
      { to: '/import', label: t('nav.import'), icon: FileSpreadsheet },
      { to: '/reports/low-stock', label: t('nav.lowStock'), icon: TriangleAlert, badge: stats?.low_stock_count },
      { to: '/settings', label: t('nav.settings'), icon: Settings },
    ],
  ];

  return (
    <nav
      aria-label={t('nav.groups.main')}
      className="flex h-12 items-stretch gap-1 overflow-x-auto px-5 xl:px-8"
    >
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex items-stretch gap-0.5">
          {groupIndex > 0 && (
            <span aria-hidden className="my-2.5 me-1.5 w-px shrink-0 bg-line" />
          )}
          {group.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn(
                'group relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-[13px] font-medium transition',
                isActive
                  ? 'text-brand-600 dark:text-brand-300'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {({ isActive }) => (
                <>
                  <item.icon className="size-4 shrink-0" />
                  <span className="whitespace-nowrap">{item.label}</span>
                  {!!item.badge && (
                    <span className={cn(
                      'nums rounded-full px-1.5 text-[10px] font-bold leading-4',
                      isActive ? 'bg-brand-600 text-white' : 'bg-surface-3 text-muted',
                    )}>
                      {item.badge}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute inset-x-1.5 bottom-0 h-[2.5px] rounded-t-full bg-brand-600" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Brand lock-up shown at the start of the header. */
export function Brand({ companyName, tagline }: { companyName: string; tagline: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/30">
        <Boxes className="size-5" />
      </div>
      <div className="hidden min-w-0 leading-tight md:block">
        <p className="truncate text-sm font-bold">{companyName}</p>
        <p className="truncate text-[11px] text-subtle">{tagline}</p>
      </div>
    </div>
  );
}
