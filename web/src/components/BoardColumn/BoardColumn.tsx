import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import type { HeadingLevel } from '../PersonCard/PersonCard'
import { CountPill } from '../StatusPill/StatusPill'
import { cx, STATUS_LABELS, type PersonStatus } from '../utils'
import styles from './BoardColumn.module.css'

/**
 * One status column on the My people board, holding MiniPersonCards. A column may be empty
 * (business rule 1: a user may have no people). It's a region named by its title.
 *
 * If the board lets people drag cards between columns, it must also offer a single-pointer
 * alternative such as a "Move to" menu (WCAG 2.5.7). Pass the drop handlers (onDragOver,
 * onDrop, …) as props; they go on the <section>.
 */
export function BoardColumn({
  status,
  title,
  count,
  rule,
  empty,
  dropActive = false,
  headingLevel = 2,
  children,
  className,
  ...rest
}: Omit<ComponentPropsWithoutRef<'section'>, 'title'> & {
  status: PersonStatus
  /** Defaults to the status word. */
  title?: ReactNode
  count: number
  /** A muted line under the title, e.g. "Contact at least every 7 days". */
  rule?: ReactNode
  /** Shown in a dashed box when the count is 0, e.g. "Drop someone here". */
  empty?: ReactNode
  /** Highlights the column while a card is dragged over it. */
  dropActive?: boolean
  /** The column title's heading level, one below the board's. Defaults to 2. */
  headingLevel?: HeadingLevel
  children?: ReactNode
  className?: string
}) {
  const Heading = `h${headingLevel}` as const
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      {...rest}
      className={cx(styles.column, dropActive && styles.dropActive, className)}
    >
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <Heading id={headingId} className={styles.title}>
            <span className={cx(styles.dot, styles[status])} aria-hidden="true" />
            {title ?? STATUS_LABELS[status]}
          </Heading>
          <CountPill count={count} />
        </div>
        {rule && <p className={styles.rule}>{rule}</p>}
      </div>
      {children}
      {count === 0 && empty && <div className={styles.empty}>{empty}</div>}
    </section>
  )
}
