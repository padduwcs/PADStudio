import {useEffect, useState} from 'react';

export type PadTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'pad-studio:theme:v1';

function preferredTheme(): PadTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // System preference remains available when storage is blocked.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function initializeTheme() {
  const theme = preferredTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  return theme;
}

export function useTheme() {
  const [theme, setTheme] = useState<PadTheme>(() => {
    const active = document.documentElement.dataset.theme;
    return active === 'dark' || active === 'light'
      ? active
      : initializeTheme();
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme still applies for the current session.
    }
  }, [theme]);

  return {
    theme,
    toggleTheme: () =>
      setTheme(current => current === 'light' ? 'dark' : 'light'),
  };
}
