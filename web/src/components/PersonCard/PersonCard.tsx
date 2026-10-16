import type { ElementType, ReactNode } from 'react'
import { Avatar, AvatarStack, type AvatarTint } from '../Avatar/Avatar'
import { ClockIcon, PlusIcon } from '../icons'
import { InsetNote, PrayerCount } from '../InsetNote/InsetNote'
import { Meter, Milestones, type MeterTone } from '../Progress/Progress'
import { DueTag, StatusPill, type DueTone } from '../StatusPill/StatusPill'
import { cx, type PersonStatus, type PolymorphicProps } from '../utils'
import styles from './PersonCard.module.css'

type NameProps = {
  name: string
  /**
   * Wraps the name, typically in a router link: `renderName={(n) => <Link to={…}>{n}</Link>}`.
   * Without it the name is plain text.
   */
  renderName?: (name: string) => ReactNode
}

function Name({ name, renderName }: NameProps) {
  return <h3 className={styles.name}>{renderName ? renderName(name) : name}</h3>
}

/** The portrait card in the My people gallery. */
export function PersonCard({
  name,
  renderName,
  subtitle,
  status,
  lastContact,
  milestones,
  shepherds,
  prayerCount,
  avatarTint = 'green',
  className,
}: NameProps & {
  /** e.g. "52 years old · Met 2016". */
  subtitle?: ReactNode
  status: PersonStatus
  /** e.g. "1 week ago". Absent when no contact has been logged (business rule 6). */
  lastContact?: ReactNode
  /** Recorded milestone names; may be empty (business rule 2). */
  milestones: readonly string[]
  /** The shepherd stack in the footer; omitted when there's no one to show. */
  shepherds?: { names: string[]; label: string }
  /** Active prayer burdens; may be zero (business rule 3). */
  prayerCount: number
  avatarTint?: AvatarTint
  className?: string
}) {
  return (
    <article className={cx(styles.card, className)}>
      <div className={styles.head}>
        <Avatar name={name} tint={avatarTint} />
        <div className={styles.who}>
          <Name name={name} renderName={renderName} />
          {subtitle && <div className={styles.sub}>{subtitle}</div>}
        </div>
      </div>
      <div className={styles.statusRow}>
        <StatusPill status={status} />
        <span className={cx(styles.sub, styles.lastContact)}>
          <ClockIcon />
          {lastContact ?? 'No contact yet'}
        </span>
      </div>
      <Milestones recorded={milestones} />
      <div className={styles.foot}>
        {shepherds && shepherds.names.length > 0 ? (
          <AvatarStack names={shepherds.names} label={shepherds.label} />
        ) : (
          <span />
        )}
        <PrayerCount count={prayerCount}>{prayerCount} praying</PrayerCount>
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
      <div className={styles.head}>
        <Avatar name={name} size="lg" tint={avatarTint} />
        <div className={styles.who}>
          <Name name={name} renderName={renderName} />
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

/** The compact card inside a board column. */
export function MiniPersonCard({
  name,
  renderName,
  lastContact,
  overdue = false,
  prayerCount,
  milestones,
  avatarTint = 'green',
  className,
}: NameProps & {
  /** e.g. "3 days ago". Absent when no contact has been logged. */
  lastContact?: ReactNode
  /** Shows the contact time in danger. */
  overdue?: boolean
  prayerCount: number
  milestones: readonly string[]
  avatarTint?: AvatarTint
  className?: string
}) {
  return (
    <article className={cx(styles.card, styles.mini, className)}>
      <div className={styles.head}>
        <Avatar name={name} size="sm" tint={avatarTint} />
        <div className={styles.who}>
          <Name name={name} renderName={renderName} />
          <div className={cx(styles.miniSub, overdue && styles.overdueText)}>
            {lastContact ?? 'No contact yet'}
          </div>
        </div>
        <PrayerCount count={prayerCount} hiddenSuffix=" praying" className={styles.miniPray} />
      </div>
      <Milestones recorded={milestones} compact />
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
