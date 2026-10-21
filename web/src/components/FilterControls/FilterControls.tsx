import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { BoardIcon, GridIcon } from '../icons'
import { cx } from '../utils'
import styles from './FilterControls.module.css'

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

/** A status filter with an optional count. Selected chips are brand; select one at a time. */
export function Chip({
  pressed,
  count,
  children,
  className,
  ...rest
}: ButtonProps & { pressed: boolean; count?: number; className?: string }) {
  return (
    <button {...rest} type="button" aria-pressed={pressed} className={cx(styles.chip, className)}>
      {children}
      {/* The space keeps the accessible name "Active 6", not "Active6"; flex drops it visually. */}
      {count !== undefined && (
        <>
          {' '}
          <span className={styles.chipCount}>{count}</span>
        </>
      )}
    </button>
  )
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode }

/** A sort selector: exactly one segment is pressed. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** The group's accessible name, e.g. "Sort". */
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cx(styles.segmented, className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export type ViewMode = 'board' | 'gallery'

const VIEWS: Array<{ value: ViewMode; label: string; icon: ReactNode }> = [
  { value: 'board', label: 'Board', icon: <BoardIcon /> },
  { value: 'gallery', label: 'Gallery', icon: <GridIcon /> },
]

/** My people's Board / Gallery switch: icon and word, exactly one pressed. */
export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode
  onChange: (value: ViewMode) => void
  className?: string
}) {
  return (
    <div role="group" aria-label="View" className={cx(styles.viewToggle, className)}>
      {VIEWS.map((view) => (
        <button
          key={view.value}
          type="button"
          className={styles.view}
          aria-pressed={value === view.value}
          onClick={() => onChange(view.value)}
        >
          {view.icon}
          {view.label}
        </button>
      ))}
    </div>
  )
}

/** A boolean option such as Hide details. The track is brand when on. */
export function Switch({
  checked,
  onChange,
  children,
  className,
  ...rest
}: Omit<ButtonProps, 'onChange'> & {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The visible label. */
  children: ReactNode
  className?: string
}) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx(styles.switch, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.track} aria-hidden="true" />
      {children}
    </button>
  )
}
