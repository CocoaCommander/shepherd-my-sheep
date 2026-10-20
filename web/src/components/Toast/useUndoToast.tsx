import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import shared from '../shared.module.css'
import { Toast } from './Toast'

/** How long a toast stays up, Undo or not; long enough for everyone to reach Undo (WCAG 2.2.1). */
export const TOAST_MS = 20_000

type Shown = { message: ReactNode; onUndo?: () => void }

/**
 * A confirmation Toast with an optional Undo, following the Toast's accessibility notes:
 * `toastElement` is always mounted (render it once, unconditionally) and only its text is
 * swapped, so screen readers announce each message. Each message stays up 20 seconds; a new
 * one replaces it and restarts the clock. Undo hides the toast, then calls `onUndo`.
 */
export function useUndoToast({
  floating = false,
  className,
}: { floating?: boolean; className?: string } = {}) {
  const [shown, setShown] = useState<Shown | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setShown(null)
  }, [])

  const show = useCallback((message: ReactNode, onUndo?: () => void) => {
    clearTimeout(timer.current)
    setShown({ message, onUndo })
    timer.current = setTimeout(() => setShown(null), TOAST_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const onUndo = shown?.onUndo
  const toastElement = (
    <Toast
      // Hidden visually but kept in the accessibility tree, so the live region stays registered.
      className={shown ? className : shared.srOnly}
      floating={floating && !!shown}
      message={shown?.message ?? ''}
      actionLabel={onUndo ? 'Undo' : undefined}
      onAction={
        onUndo
          ? () => {
              hide()
              onUndo()
            }
          : undefined
      }
    />
  )

  return { show, hide, toastElement }
}
