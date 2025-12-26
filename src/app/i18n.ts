import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en';
import { sr } from './locales/sr';

export type AppLanguage = 'sr' | 'en';

export function normalizeLanguage(lang: string | undefined | null): AppLanguage {
  if (!lang) return 'sr';
  const lower = lang.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  return 'sr';
}

export function getNumberLocale(lang: AppLanguage): string {
  return lang === 'en' ? 'en-US' : 'sr-RS';
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        sr: { translation: sr },
      },
      lng: 'sr',
      fallbackLng: 'sr',
      interpolation: { escapeValue: false },
    })
    .catch(() => {
      // ignore init errors; app will still render with raw strings if needed
    });
}

export default i18n;
