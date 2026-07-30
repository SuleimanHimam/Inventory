import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import en from './en.json';

/**
 * Internationalisation layer.
 *
 * Arabic is the default and only fully-populated locale for this release.
 * English resources are shipped for the shared vocabulary (navigation,
 * statuses, common actions) so a second locale is a translation-file task
 * rather than a code change — see the i18n note in README.md.
 */
export const LOCALES = {
  ar: { label: 'العربية', dir: 'rtl' as const },
  en: { label: 'English', dir: 'ltr' as const },
};

export type Locale = keyof typeof LOCALES;

export const STORAGE_KEY = 'inv.locale';

const initial = (localStorage.getItem(STORAGE_KEY) as Locale) || 'ar';

i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: initial,
  fallbackLng: 'ar',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

/** Keep <html lang/dir> in step with the active locale. */
export function applyLocale(locale: Locale) {
  const { dir } = LOCALES[locale];
  document.documentElement.setAttribute('lang', locale);
  document.documentElement.setAttribute('dir', dir);
  localStorage.setItem(STORAGE_KEY, locale);
  return i18n.changeLanguage(locale);
}

applyLocale(initial);

export default i18n;
