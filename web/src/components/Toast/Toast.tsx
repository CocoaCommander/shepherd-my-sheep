import type { ReactNode } from 'react'
import { Button } from '../Button/Button'
import { cx } from '../utils'
import styles from './Toast.module.css'

/**
 * A short confirmation after a reversible action, with a single Undo-style action.
 * Not for errors; use an inline Alert for those.
 *
 * Accessibility, for the caller:
 * - If you dismiss it on a timer while it has an action, keep it up while it's hovered or
 *   focused, or for at least 20 seconds, so everyone can reach Undo (WCAG 2.2.1).
 * - Screen readers announce changes to an existing live region more reliably than a new one,
 *   so keep the Toast mounted and swap its message rather than mounting it with text (4.1.3).
 * - When `floating`, make sure it doesn't cover the element that has keyboard focus (2.4.11).
 */
export function Toast({
  message,
  actionLabel,
  onAction,
  floating = false,
  className,
}: {
  /** e.g. "Prayer released." */
  message: ReactNode
  /** e.g. "Undo". Shown only together with onAction. */
  actionLabel?: string
  onAction?: () => void
  /** Pins it top right under the header instead of in the flow. */
  floating?: boolean
  className?: string
}) {
  return (
    <div role="status" className={cx(styles.toast, floating && styles.floating, className)}>
      <span>{message}</span>
      {actionLabel && onAction && (
        <Button variant="inverse" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
