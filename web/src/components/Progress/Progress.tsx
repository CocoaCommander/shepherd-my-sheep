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
  detail,
  goal,
  className,
}: {
  value: number
  max: number
  tone?: MeterTone
  /** e.g. "21 days since last contact". */
  label: string
  /** Muted after the label, e.g. "Thu, Sep 24". Left out of the bar's accessible name. */
  detail?: string
  /** e.g. "Goal: every 7 days". */
  goal?: string
  className?: string
}) {
  const percent = meterPercent(value, max)
  return (
    <div className={cx(styles.meterBlock, tone !== 'ok' && styles[tone], className)}>
      <div className={styles.meterRow}>
        <span className={styles.meterLabel}>
          {label}
          {detail && <span className={styles.meterDetail}> · {detail}</span>}
        </span>
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

export type StepOutcome = 'logged' | 'skipped'

/**
 * Progress through the Review flow. Without `outcomes`, visited steps are danger and the rest
 * sunken. With them, the current step is danger, logged ones brand and skipped ones warn, and
 * the counts join the accessible name so colour isn't the only signal.
 */
export function Stepper({
  current,
  total,
  outcomes,
  className,
}: {
  /** 1-based; steps up to and including it are marked. */
  current: number
  total: number
  /** By step index; undefined for a step not done yet. */
  outcomes?: readonly (StepOutcome | undefined)[]
  className?: string
}) {
  const logged = outcomes?.filter((o) => o === 'logged').length ?? 0
  const skipped = outcomes?.filter((o) => o === 'skipped').length ?? 0
  const label =
    logged + skipped > 0
      ? `Step ${current} of ${total}. ${logged} logged, ${skipped} skipped.`
      : `Step ${current} of ${total}`
  const stepClass = (i: number) => {
    if (!outcomes) return i < current && styles.on
    if (i === current - 1) return styles.on
    const outcome = outcomes[i]
    return outcome && styles[outcome]
  }

  return (
    <div className={cx(styles.stepper, className)} role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={cx(styles.stepperStep, stepClass(i))} />
      ))}
    </div>
  )
}
