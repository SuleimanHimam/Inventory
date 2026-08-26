import { create } from 'zustand';
import type { Settings } from '@/lib/types';

type Theme = 'light' | 'dark';

/**
 * How a list page renders where there is room for a choice.
 *
 * Only meaningful on a wide screen with a pointer: below that the card grid is
 * the only sensible layout and the toggle is not offered at all. Stored per
 * device rather than in the org's settings -- it is about the screen in front
 * of someone, so the same account on a desk and on a tablet should not have to
 * agree with itself.
 */
export type ListView = 'table' | 'gallery';

type PrefsState = {
  theme: Theme;
  listView: ListView;
  digits: 'latn' | 'arab';
  currency: string;
  companyName: string;
  lowStockThreshold: number;
  setTheme: (theme: Theme) => void;
  setListView: (view: ListView) => void;
  toggleTheme: () => void;
  hydrate: (settings: Settings) => void;
};

const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('inv.theme', theme);
};

const applyListView = (view: ListView) => {
  // On <html>, so the CSS that swaps the two layouts stays a media query with
  // one extra selector rather than a second copy of the layout in JS.
  document.documentElement.dataset.view = view;
  try { localStorage.setItem('inv.list_view', view); } catch { /* private window */ }
};

const storedListView = (): ListView => {
  try {
    return localStorage.getItem('inv.list_view') === 'gallery' ? 'gallery' : 'table';
  } catch {
    return 'table';
  }
};

const storedTheme = (): Theme => {
  const saved = localStorage.getItem('inv.theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return 'light';
};

export const usePrefs = create<PrefsState>((set, get) => ({
  theme: storedTheme(),
  listView: storedListView(),
  digits: 'latn',
  currency: 'ILS',
  companyName: 'شركتي',
  lowStockThreshold: 5,

  setTheme: (theme) => { applyTheme(theme); set({ theme }); },
  setListView: (view) => { applyListView(view); set({ listView: view }); },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  /** Adopt server-side settings once they load. */
  hydrate: (settings) => set({
    digits: settings.digits === 'arab' ? 'arab' : 'latn',
    currency: settings.currency || 'ILS',
    companyName: settings.company_name || 'شركتي',
    lowStockThreshold: Number(settings.low_stock_threshold ?? 5),
  }),
}));

// The attribute has to be on <html> before the first paint, not after a click.
applyListView(storedListView());
