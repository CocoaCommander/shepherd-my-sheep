import type { ReactNode } from 'react'
import { CheckIcon, HeartIcon } from '../icons'
import shared from '../shared.module.css'
import { cx } from '../utils'
import styles from './InsetNote.module.css'

/** A quiet panel for the last note or a prayer burden inside a card. Never for actions. */
export function InsetNote({
  label,
  children,
  className,
}: {
  /** e.g. "Last note, 3 weeks ago" or "Prayer burden". */
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx(styles.inset, className)}>
      <div className={styles.label}>{label}</div>
      {children}
    </div>
  )
}

/** A milestone tag. The check and the dash style carry the state, not colour alone. */
export function MilestoneTag({
  done = false,
  children,
  className,
}: {
  done?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cx(styles.tag, done && styles.done, className)}>
      {done && <CheckIcon size={12} strokeWidth={2.2} />}
      {children}
    </span>
  )
}

/**
 * A heart and a prayer count or burden. Muted at zero, since a person may have no prayer
 * burdens (business rule 3).
 */
export function PrayerCount({
  count,
  hiddenSuffix,
  children,
  className,
}: {
  count: number
  /** Read after a bare count by screen readers only, e.g. " praying". */
  hiddenSuffix?: string
  /** Defaults to the bare count. */
  children?: ReactNode
  className?: string
}) {
  return (
    <span className={cx(styles.pray, count === 0 && styles.prayNone, className)}>
      <HeartIcon />
      {children ?? count}
      {hiddenSuffix && <span className={shared.srOnly}>{hiddenSuffix}</span>}
    </span>
  )
}
