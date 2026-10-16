import type { ReactNode } from 'react'
import { CountPill } from '../StatusPill/StatusPill'
import { cx, STATUS_LABELS, type PersonStatus } from '../utils'
import styles from './BoardColumn.module.css'

/**
 * One status column on the My people board, holding MiniPersonCards. A column may be empty
 * (business rule 1: a user may have no people).
 */
export function BoardColumn({
  status,
  title,
  count,
  children,
  className,
}: {
  status: PersonStatus
  /** Defaults to the status word. */
  title?: ReactNode
  count: number
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cx(styles.column, className)}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          <span className={cx(styles.dot, styles[status])} aria-hidden="true" />
          {title ?? STATUS_LABELS[status]}
        </h2>
        <CountPill count={count} />
      </div>
      {children}
    </section>
  )
}
