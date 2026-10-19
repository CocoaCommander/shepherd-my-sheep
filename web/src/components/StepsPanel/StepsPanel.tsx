import { useId, type ReactNode } from 'react'
import type { HeadingLevel } from '../PersonCard/PersonCard'
import { cx } from '../utils'
import styles from './StepsPanel.module.css'

/** A short numbered list of what happens next, e.g. after adding a person. */
export function StepsPanel({
  items,
  heading = 'What happens next',
  headingLevel = 2,
  className,
}: {
  /** One sentence each, in order. */
  items: ReactNode[]
  heading?: ReactNode
  headingLevel?: HeadingLevel
  className?: string
}) {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <section aria-labelledby={headingId} className={cx(styles.panel, className)}>
      <Heading id={headingId} className={styles.heading}>
        {heading}
      </Heading>
      <ol className={styles.steps}>
        {items.map((item, i) => (
          <li key={i} className={styles.step}>
            {item}
          </li>
        ))}
      </ol>
    </section>
  )
}
