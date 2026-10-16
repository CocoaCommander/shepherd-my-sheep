import type { ReactNode } from 'react'
import { CheckIcon, ClockIcon, WarningIcon } from '../icons'
import { cx, STATUS_LABELS, type PersonStatus } from '../utils'
import styles from './StatusPill.module.css'

/** A person's pastoral status. The word is always shown; colour is secondary. */
export function StatusPill({
  status,
  children,
  className,
}: {
  status: PersonStatus
  /** Defaults to the status word: New contact, Active, Inactive, Lost contact. */
  children?: ReactNode
  className?: string
}) {
  return (
    <span className={cx(styles.pill, styles[status], className)}>
      {children ?? STATUS_LABELS[status]}
    </span>
  )
}

export type DueTone = 'overdue' | 'soon' | 'ok'

const dueIcons: Record<DueTone, ReactNode> = {
  overdue: <WarningIcon />,
  soon: <ClockIcon />,
  ok: <CheckIcon />,
}

/** Contact timing on a person card. Always an icon and words, never colour alone. */
export function DueTag({
  tone,
  children,
  className,
}: {
  tone: DueTone
  /** e.g. "14 days overdue", "Due in 2 days", "On track". */
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cx(styles.tag, styles[tone], className)}>
      {dueIcons[tone]}
      {children}
    </span>
  )
}

export type CountTone = 'default' | 'danger' | 'warn' | 'ok'

const countClass: Record<CountTone, string | undefined> = {
  default: undefined,
  danger: styles.countDanger,
  warn: styles.countWarn,
  ok: styles.countOk,
}

/** The number beside a section or column title; its tone follows the section's urgency. */
export function CountPill({
  count,
  tone = 'default',
  className,
}: {
  count: number
  tone?: CountTone
  className?: string
}) {
  return <span className={cx(styles.count, countClass[tone], className)}>{count}</span>
}
