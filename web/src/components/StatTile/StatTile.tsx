import type { ElementType } from 'react'
import { cx, type PolymorphicProps } from '../utils'
import styles from './StatTile.module.css'

export type StatTone = 'danger' | 'warn' | 'ok' | 'neutral'

type StatTileOwnProps = {
  /** Overdue: danger, Coming up: warn, On track: ok, Not tracked: neutral. */
  tone?: StatTone
  count: number
  label: string
  /** The policy behind the number, in words, e.g. "Due within 2 days". */
  rule: string
  className?: string
}

/** A linked summary tile: a number, a label and the rule behind it. Renders an <a> by default. */
export function StatTile<E extends ElementType = 'a'>({
  as,
  tone = 'neutral',
  count,
  label,
  rule,
  className,
  ...rest
}: PolymorphicProps<E, StatTileOwnProps>) {
  const Component: ElementType = as ?? 'a'
  return (
    <Component {...rest} className={cx(styles.stat, tone !== 'neutral' && styles[tone], className)}>
      <span className={styles.number}>{count}</span>{' '}
      <span>
        <span className={styles.label}>{label}</span>
        <span className={styles.rule}>{rule}</span>
      </span>
    </Component>
  )
}
