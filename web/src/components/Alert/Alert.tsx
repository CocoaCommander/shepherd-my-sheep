import type { ReactNode } from 'react'
import { WarningIcon } from '../icons'
import { cx } from '../utils'
import styles from './Alert.module.css'

export type AlertVariant = 'banner' | 'inline' | 'success'

/**
 * A state that needs attention. banner: the Home overdue banner, with a single action.
 * inline: a form-level error. success: a confirmation, announced politely.
 */
export function Alert({
  variant = 'banner',
  title,
  action,
  icon,
  children,
  className,
}: {
  variant?: AlertVariant
  /** e.g. "4 people are overdue for contact". */
  title?: ReactNode
  /** One action, e.g. a danger Button "Review now". Banner only. */
  action?: ReactNode
  /** Defaults to the warning triangle for banner and inline; pass null to drop it. */
  icon?: ReactNode | null
  children?: ReactNode
  className?: string
}) {
  const defaultIcon =
    variant === 'banner' ? (
      <WarningIcon size={28} />
    ) : variant === 'inline' ? (
      <WarningIcon size={18} />
    ) : null
  const shownIcon = icon === undefined ? defaultIcon : icon
  return (
    <div
      role={variant === 'success' ? 'status' : 'alert'}
      className={cx(
        styles.alert,
        variant === 'inline' && styles.inline,
        variant === 'success' && cx(styles.inline, styles.success),
        className,
      )}
    >
      <div className={styles.main}>
        {shownIcon && <span className={styles.icon}>{shownIcon}</span>}
        <div>
          {title && <div className={styles.title}>{title}</div>}
          {children && <div>{children}</div>}
        </div>
      </div>
      {variant === 'banner' && action}
    </div>
  )
}
