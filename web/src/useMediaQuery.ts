import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, kept up to date as the window resizes. For layouts that
 * differ in structure, not just style, so only one is in the DOM. False where matchMedia is
 * missing (jsdom), so tests get the wide layout unless they stub it.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
  )
}

/** Below 720px, the mobile web layout (the breakpoint AppHeader and the pages use). */
export const NARROW = '(max-width: 719px)'
