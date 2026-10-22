import { useSyncExternalStore } from 'react'
import { useMediaQuery } from './useMediaQuery'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'shepherd.theme'

/**
 * The theme last chosen with the header toggle on this device, or null to follow the OS.
 * Anything but 'light' or 'dark', or storage that is blocked or throws (private windows),
 * also means follow the OS.
 */
export function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

/**
 * Sets data-theme on <html> from the stored choice, which tokens.css lets win over the OS
 * setting; with no choice it leaves it unset. main.tsx calls it before the first render.
 */
export function applyStoredTheme() {
  const theme = readStoredTheme()
  if (theme) document.documentElement.dataset.theme = theme
  else delete document.documentElement.dataset.theme
}

const listeners = new Set<() => void>()

/** Stores the choice and applies it at once. There is no way back to following the OS. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Ignored, see readStoredTheme: the choice applies but isn't remembered.
  }
  document.documentElement.dataset.theme = theme
  listeners.forEach((listener) => listener())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/** The data-theme set by setTheme, which outlives storage that throws. */
function chosenTheme(): Theme | null {
  const theme = document.documentElement.dataset.theme
  return theme === 'light' || theme === 'dark' ? theme : readStoredTheme()
}

/**
 * The theme in effect: the stored choice, else the OS's, followed live until a choice is
 * stored.
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const chosen = useSyncExternalStore(subscribe, chosenTheme)
  const osDark = useMediaQuery('(prefers-color-scheme: dark)')
  return { theme: chosen ?? (osDark ? 'dark' : 'light'), setTheme }
}
