import type { ReactNode } from 'react'
import type { HeadingLevel } from '../PersonCard/PersonCard'
import { CountPill } from '../StatusPill/StatusPill'
import { cx, STATUS_LABELS, type PersonStatus } from '../utils'
import styles from './BoardColumn.module.css'

/**
 * One status column on the My people board, holding MiniPersonCards. A column may be empty
 * (business rule 1: a user may have no people).
 *
 * If the board lets people drag cards between columns, it must also offer a single-pointer
 * alternative such as a "Move to" menu (WCAG 2.5.7).
 */
export function BoardColumn({
  status,
  title,
  count,
  headingLevel = 2,
  children,
  className,
}: {
  status: PersonStatus
  /** Defaults to the status word. */
  title?: ReactNode
  count: number
  /** The column title's heading level, one below the board's. Defaults to 2. */
  headingLevel?: HeadingLevel
  children?: ReactNode
  className?: string
}) {
  const Heading = `h${headingLevel}` as const
  return (
    <section className={cx(styles.column, className)}>
      <div className={styles.head}>
        <Heading className={styles.title}>
          <span className={cx(styles.dot, styles[status])} aria-hidden="true" />
          {title ?? STATUS_LABELS[status]}
        </Heading>
        <CountPill count={count} />
      </div>
      {children}
    </section>
  )
}
