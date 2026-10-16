import type { ReactNode } from 'react'
import { Button } from '../Button/Button'
import { cx } from '../utils'
import styles from './Toast.module.css'

/**
 * A short confirmation after a reversible action, with a single Undo-style action.
 * Not for errors; use an inline Alert for those.
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
