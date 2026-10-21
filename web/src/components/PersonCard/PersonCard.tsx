import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { Avatar, AvatarStack, type AvatarTint } from '../Avatar/Avatar'
import { ClockIcon, GripIcon, PlusIcon, WarningIcon } from '../icons'
import { InsetNote, PrayerCount } from '../InsetNote/InsetNote'
import { Meter, Milestones, type MeterTone } from '../Progress/Progress'
import shared from '../shared.module.css'
import { DueTag, StatusPill, type DueTone } from '../StatusPill/StatusPill'
import { cx, type PersonStatus, type PolymorphicProps } from '../utils'
import styles from './PersonCard.module.css'

export type HeadingLevel = 2 | 3 | 4 | 5 | 6

type NameProps = {
  name: string
  /**
   * Wraps the name, typically in a router link: `renderName={(n) => <Link to={…}>{n}</Link>}`.
   * Without it the name is plain text.
   */
  renderName?: (name: string) => ReactNode
  /** The name's heading level, one below the section it sits in. Defaults to 3. */
  headingLevel?: HeadingLevel
}

function Name({ name, renderName, headingLevel = 3 }: NameProps) {
  const Heading = `h${headingLevel}` as const
  return <Heading className={styles.name}>{renderName ? renderName(name) : name}</Heading>
}

/**
 * The portrait card in the My people gallery. `compact` is the 2-up mobile web card: avatar,
 * name, status, tag and the milestone bar only (no subtitle, last contact, shepherds or prayer).
 */
export function PersonCard({
  name,
  renderName,
  subtitle,
  status,
  tag,
  lastContact,
  milestones,
  shepherds,
  prayerCount,
  compact = false,
  avatarTint = 'green',
  headingLevel,
  className,
}: NameProps & {
  /** e.g. "52 years old · Met 2016". */
  subtitle?: ReactNode
  status: PersonStatus
  /** Beside the status, typically the contact DueTag. */
  tag?: ReactNode
  /** e.g. "1 week ago". Absent when no contact has been logged (business rule 6). */
  lastContact?: ReactNode
  /** Recorded milestone names; may be empty (business rule 2). */
  milestones: readonly string[]
  /** The shepherd stack beside the name; omitted when there's no one to show. */
  shepherds?: { names: string[]; label: string }
  /** Active prayer burdens; may be zero (business rule 3). */
  prayerCount: number
  compact?: boolean
  avatarTint?: AvatarTint
  className?: string
}) {
  if (compact) {
    return (
      <article className={cx(styles.card, styles.compact, className)}>
        <Avatar name={name} size="lg" tint={avatarTint} />
        <Name name={name} renderName={renderName} headingLevel={headingLevel} />
        <StatusPill status={status} />
        {tag}
        <Milestones recorded={milestones} compact className={styles.compactBar} />
      </article>
    )
  }

  return (
    <article className={cx(styles.card, className)}>
      <div className={styles.head}>
        <Avatar name={name} tint={avatarTint} />
        <div className={styles.who}>
          <Name name={name} renderName={renderName} headingLevel={headingLevel} />
          {subtitle && <div className={styles.sub}>{subtitle}</div>}
        </div>
        {shepherds && shepherds.names.length > 0 && (
          <AvatarStack names={shepherds.names} label={shepherds.label} />
        )}
      </div>
      <div className={styles.statusRow}>
        <StatusPill status={status} />
        {tag}
      </div>
      <Milestones recorded={milestones} />
      <div className={styles.foot}>
        <span className={cx(styles.sub, styles.lastContact)}>
          <ClockIcon />
          {lastContact ? <>Last contact: {lastContact}</> : 'No contact yet'}
        </span>
        <PrayerCount count={prayerCount} hiddenSuffix=" praying" />
      </div>
    </article>
  )
}

export type CareUrgency = 'overdue' | 'soon' | 'ok'

const meterTone: Record<CareUrgency, MeterTone> = { overdue: 'danger', soon: 'warn', ok: 'ok' }
const dueTone: Record<CareUrgency, DueTone> = { overdue: 'overdue', soon: 'soon', ok: 'ok' }

/**
 * The care card on Home: contact meter against the goal, a due tag, an optional last note
 * and the actions. Overdue cards pair with a danger Button; coming-up cards with primary.
 */
export function CareCard({
  name,
  renderName,
  status,
  urgency,
  dueLabel,
  meter,
  note,
  actions,
  aside,
  avatarTint = 'green',
  headingLevel,
  className,
}: NameProps & {
  status: PersonStatus
  urgency: CareUrgency
  /** The due tag's words, e.g. "14 days overdue" or "24 hours left". */
  dueLabel: ReactNode
  meter: { value: number; max: number; label: string; goal?: string }
  /** The last note, e.g. { label: "Last note, 3 weeks ago", content: "…" }. */
  note?: { label: ReactNode; content: ReactNode }
  actions?: ReactNode
  /** A muted line at the end of the action row, e.g. "Shared with Grace Lin". */
  aside?: ReactNode
  avatarTint?: AvatarTint
  className?: string
}) {
  return (
    <article
      className={cx(
        styles.card,
        urgency === 'overdue' && styles.overdue,
        urgency === 'soon' && styles.soon,
        className,
      )}
    >
      <div className={cx(styles.head, styles.careHead)}>
        <Avatar name={name} size="lg" tint={avatarTint} />
        <div className={styles.who}>
          <Name name={name} renderName={renderName} headingLevel={headingLevel} />
          <StatusPill status={status} />
        </div>
        <DueTag tone={dueTone[urgency]}>{dueLabel}</DueTag>
      </div>
      <Meter {...meter} tone={meterTone[urgency]} />
      {note && <InsetNote label={note.label}>{note.content}</InsetNote>}
      {(actions || aside) && (
        <div className={styles.actions}>
          {actions}
          {aside && <span className={styles.aside}>{aside}</span>}
        </div>
      )}
    </article>
  )
}

/**
 * The compact card inside a board column. To make it draggable, pass `grip` with `draggable`
 * and the drag handlers (they go on the <article>); dragging also needs a "Move to" control in
 * `actions` for keyboard, screen-reader and single-pointer users (WCAG 2.5.7).
 */
export function MiniPersonCard({
  name,
  renderName,
  lastContact,
  overdue = false,
  prayerCount,
  milestones,
  tag,
  actions,
  grip = false,
  avatarTint = 'green',
  headingLevel,
  className,
  ...rest
}: NameProps &
  Omit<ComponentPropsWithoutRef<'article'>, 'children'> & {
    /** e.g. "3 days ago". Absent when no contact has been logged. */
    lastContact?: ReactNode
    /**
     * Shows the contact time in danger with a warning icon, and tells screen readers
     * "Overdue", so colour isn't the only signal (WCAG 1.4.1).
     */
    overdue?: boolean
    prayerCount: number
    milestones: readonly string[]
    /** The contact tag under the milestones, typically a DueTag. */
    tag?: ReactNode
    /** Beside the tag, e.g. a "Move to" select. */
    actions?: ReactNode
    /** Shows grip dots, for a card that can be dragged. */
    grip?: boolean
    avatarTint?: AvatarTint
    className?: string
  }) {
  return (
    <article {...rest} className={cx(styles.card, styles.mini, className)}>
      <div className={styles.head}>
        {grip && <GripIcon className={styles.grip} />}
        <Avatar name={name} size="sm" tint={avatarTint} />
        <div className={styles.who}>
          <Name name={name} renderName={renderName} headingLevel={headingLevel} />
          <div className={cx(styles.miniSub, overdue && styles.overdueText)}>
            {overdue && (
              <>
                <WarningIcon size={12} />
                <span className={shared.srOnly}>Overdue: </span>
              </>
            )}
            {lastContact ?? 'No contact yet'}
          </div>
        </div>
        <PrayerCount count={prayerCount} hiddenSuffix=" praying" className={styles.miniPray} />
      </div>
      <Milestones recorded={milestones} compact />
      {(tag || actions) && (
        <div className={styles.miniFoot}>
          {tag ?? <span />}
          {actions}
        </div>
      )}
    </article>
  )
}

type AddTileOwnProps = { children?: ReactNode; className?: string }

/** The dashed "Add someone new" tile that ends a gallery. Renders an <a> by default. */
export function AddPersonTile<E extends ElementType = 'a'>({
  as,
  children = 'Add someone new',
  className,
  ...rest
}: PolymorphicProps<E, AddTileOwnProps>) {
  const Component: ElementType = as ?? 'a'
  return (
    <Component {...rest} className={cx(styles.add, className)}>
      <PlusIcon size={28} />
      {children}
    </Component>
  )
}
