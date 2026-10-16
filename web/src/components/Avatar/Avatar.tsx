import { cx } from '../utils'
import styles from './Avatar.module.css'

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'
export type AvatarTint = 'green' | 'blue' | 'sand' | 'rose' | 'violet'

const TINTS: AvatarTint[] = ['green', 'blue', 'sand', 'rose', 'violet']

/** Rotates the five tints by list position so neighbouring avatars differ. */
export function avatarTint(index: number): AvatarTint {
  return TINTS[((index % TINTS.length) + TINTS.length) % TINTS.length]
}

/** First letters of the first and last name: "Maria del Santos" → "MS". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return (first + last).toUpperCase()
}

const sizeClass: Record<AvatarSize, string | undefined> = {
  sm: styles.sm,
  md: undefined,
  lg: styles.lg,
  xl: styles.xl,
}

/**
 * Initials in a tinted circle. Decorative next to a name, so it is hidden from assistive tech.
 * Sizes: sm 36 (board), md 44 (cards), lg 48 (home cards), xl 64 (review card).
 */
export function Avatar({
  name,
  size = 'md',
  tint = 'green',
  className,
}: {
  name: string
  size?: AvatarSize
  tint?: AvatarTint
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cx(styles.avatar, sizeClass[size], tint !== 'green' && styles[tint], className)}
    >
      {initials(name)}
    </div>
  )
}

/** The overlapping shepherd avatars in a card footer, read as one labelled image. */
export function AvatarStack({
  names,
  label,
  className,
}: {
  names: string[]
  /** e.g. "Shepherded by you and one other". */
  label: string
  className?: string
}) {
  return (
    <div role="img" aria-label={label} className={cx(styles.stack, className)}>
      {names.map((name, i) => (
        <div key={`${name}-${i}`} className={styles.stackItem}>
          {initials(name)}
        </div>
      ))}
    </div>
  )
}
