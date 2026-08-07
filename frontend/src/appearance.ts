import { useEffect, useState } from 'react';

export type SiteTheme =
  | 'paper'
  | 'sepia'
  | 'green'
  | 'gray'
  | 'dark'
  | 'midnight'
  | 'charcoal'
  | 'coffee';

export interface SiteThemeOption {
  value: SiteTheme;
  label: string;
  color: string;
  page: string;
  dark: boolean;
}

export const siteThemeOptions: SiteThemeOption[] = [
  { value: 'paper', label: '纯白', color: '#ffffff', page: '#f5f7fa', dark: false },
  { value: 'sepia', label: '暖黄', color: '#f7f1df', page: '#e9e0c9', dark: false },
  { value: 'green', label: '护眼绿', color: '#eaf4e2', page: '#dce9d6', dark: false },
  { value: 'gray', label: '柔灰', color: '#edf0f2', page: '#dde1e5', dark: false },
  { value: 'dark', label: '深黑', color: '#171717', page: '#000000', dark: true },
  { value: 'midnight', label: '夜蓝', color: '#111827', page: '#0b1120', dark: true },
  { value: 'charcoal', label: '炭灰', color: '#20252b', page: '#14181c', dark: true },
  { value: 'coffee', label: '暖黑', color: '#29211d', page: '#1b1613', dark: true },
];

const STORAGE_KEY = 'site-theme';
const CHANGE_EVENT = 'site-theme-change';

function isSiteTheme(value: string | null): value is SiteTheme {
  return siteThemeOptions.some((option) => option.value === value);
}

export function getInitialSiteTheme(): SiteTheme {
  const saved = window.localStorage.getItem(STORAGE_KEY)
    ?? window.localStorage.getItem('reader-theme');
  if (isSiteTheme(saved)) return saved;
  const configuredDefault = import.meta.env.VITE_DEFAULT_SITE_THEME;
  if (isSiteTheme(configuredDefault)) return configuredDefault;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'paper';
}

export function hasStoredSiteTheme() {
  return Boolean(
    window.localStorage.getItem(STORAGE_KEY)
    ?? window.localStorage.getItem('reader-theme'),
  );
}

export function applySiteTheme(value: SiteTheme) {
  window.localStorage.setItem(STORAGE_KEY, value);
  window.localStorage.setItem('reader-theme', value);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
}

export function useSiteTheme() {
  const [siteTheme, setSiteThemeState] = useState<SiteTheme>(getInitialSiteTheme);

  useEffect(() => {
    const sync = (event: Event) => {
      const value = (event as CustomEvent<SiteTheme>).detail;
      if (isSiteTheme(value)) setSiteThemeState(value);
    };
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const setSiteTheme = (value: SiteTheme) => {
    setSiteThemeState(value);
    applySiteTheme(value);
  };

  return {
    siteTheme,
    setSiteTheme,
    option: siteThemeOptions.find((item) => item.value === siteTheme)!,
  };
}
