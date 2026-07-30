import { create } from 'zustand';
import type { Settings } from '@/lib/types';

type Theme = 'light' | 'dark';

type PrefsState = {
  theme: Theme;
  digits: 'latn' | 'arab';
  currency: string;
  companyName: string;
  lowStockThreshold: number;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  hydrate: (settings: Settings) => void;
};

const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('inv.theme', theme);
};

const storedTheme = (): Theme => {
  const saved = localStorage.getItem('inv.theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const usePrefs = create<PrefsState>((set, get) => ({
  theme: storedTheme(),
  digits: 'latn',
  currency: 'ILS',
  companyName: 'شركتي',
  lowStockThreshold: 5,

  setTheme: (theme) => { applyTheme(theme); set({ theme }); },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  /** Adopt server-side settings once they load. */
  hydrate: (settings) => set({
    digits: settings.digits === 'arab' ? 'arab' : 'latn',
    currency: settings.currency || 'ILS',
    companyName: settings.company_name || 'شركتي',
    lowStockThreshold: Number(settings.low_stock_threshold ?? 5),
  }),
}));
