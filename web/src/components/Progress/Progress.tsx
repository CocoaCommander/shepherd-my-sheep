import type { CSSProperties } from 'react'
import { cx } from '../utils'
import styles from './Progress.module.css'

export type MeterTone = 'ok' | 'warn' | 'danger'

/** Share of the window used, as a percentage capped to 0–100. */
export function meterPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0
  return Math.min(100, (value / max) * 100)
}

/**
 * Time since contact against a goal. Fill is brand when on track, warn when coming up and
 * danger when overdue. The words sit beside the bar so the graphic is never the only signal.
 */
export function Meter({
  value,
  max,
  tone = 'ok',
  label,
  goal,
  className,
}: {
  value: number
  max: number
  tone?: MeterTone
  /** e.g. "21 days since last contact". */
  label: string
  /** e.g. "Goal: every 7 days". */
  goal?: string
  className?: string
}) {
  const percent = meterPercent(value, max)
  return (
    <div className={cx(styles.meterBlock, tone !== 'ok' && styles[tone], className)}>
      <div className={styles.meterRow}>
        <span className={styles.meterLabel}>{label}</span>
        {goal && <span className={styles.meterGoal}>{goal}</span>}
      </div>
      <div className={styles.meter} role="img" aria-label={goal ? `${label}. ${goal}` : label}>
        <span className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** The milestones every person can record, in the order the bar shows them. */
export const MILESTONES = ['Baptised', 'Small group', 'Serving', 'Leading'] as const

/**
 * The milestone bar. A person may have recorded none (business rule 2), so an empty list is
 * a normal state. The caption names what's recorded so the bar isn't the only signal.
 */
export function Milestones({
  recorded,
  steps = MILESTONES,
  compact = false,
  showCaption = !compact,
  className,
}: {
  recorded: readonly string[]
  steps?: readonly string[]
  /** The 5px bar used in mini cards. */
  compact?: boolean
  showCaption?: boolean
  className?: string
}) {
  const done = steps.filter((step) => recorded.includes(step))
  const summary =
    done.length === 0
      ? 'No milestones yet'
      : `${done.length} of ${steps.length}: ${done.join(', ')}`
  return (
    <div className={cx(styles.milestones, compact && styles.compact, className)}>
      <div
        className={styles.steps}
        role="img"
        aria-label={`Milestones: ${summary}`}
        style={{ '--sms-steps': steps.length } as CSSProperties}
      >
        {steps.map((step) => (
          <i key={step} className={cx(styles.step, done.includes(step) && styles.on)} />
        ))}
      </div>
      {showCaption && <p className={styles.caption}>{summary}</p>}
    </div>
  )
}

/** Progress through the Review flow: visited steps are danger, the rest sunken. */
export function Stepper({
  current,
  total,
  className,
}: {
  /** 1-based; steps up to and including it are marked. */
  current: number
  total: number
  className?: string
}) {
  return (
    <div
      className={cx(styles.stepper, className)}
      role="img"
      aria-label={`Step ${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={cx(styles.stepperStep, i < current && styles.on)} />
      ))}
    </div>
  )
}
