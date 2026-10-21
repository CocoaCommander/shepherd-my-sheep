import { useId, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'
import { Avatar, avatarTint, STATUS_LABELS } from '../components'
import { cx } from '../components/utils'
import {
  dateAgo,
  firstName,
  formatDateTime,
  humanSpan,
  parseDateTime,
  todayIsoDate,
} from '../format'
import {
  useDeletePersonMutation,
  useUnassignPersonMutation,
  type PersonQuery,
} from '../generated/graphql'
import { AddShepherd } from './AddShepherd'
import { ConfirmButton } from './ConfirmButton'
import { RELOAD_CONTACT_LISTS } from './contactToast'
import section from './PersonSection.module.css'
import styles from './PersonSidebar.module.css'
import { STATUS_BY_NAME } from './personStatus'

type Person = NonNullable<PersonQuery['person']>

/** The contact rule for the person's status, in words (business rule 6). */
function contactRule(status: string): string {
  switch (status) {
    case 'new contact':
      return 'A new contact needs a follow-up within 72 hours of being added. When you log it, they become Active.'
    case 'active':
      return 'Active people are contacted at least once every 7 days after the last contact. An alert shows on Home when this passes.'
    default:
      return 'Contact reminders are off while they are inactive or lost contact.'
  }
}

/**
 * The Person page's sidebar (web) or lower sections (phones): Details, Shepherds, the contact
 * rule and Delete. Phones show them in a different order, set by the stylesheet.
 */
export function PersonSidebar({
  person,
  meId,
  statusSelect,
  now = new Date(),
}: {
  person: Person
  meId: string | undefined
  /** The status dropdown, on phones only (the web has it in the header card). */
  statusSelect?: ReactNode
  now?: Date
}) {
  const ruleId = useId()

  return (
    <aside className={styles.sidebar} aria-label="About">
      <Details person={person} statusSelect={statusSelect} now={now} />
      <Shepherds person={person} meId={meId} />
      <section className={cx(section.card, styles.card, styles.rule)} aria-labelledby={ruleId}>
        <h2 id={ruleId} className={styles.title}>
          Contact rule
        </h2>
        <p className={styles.ruleText}>{contactRule(person.status.name)}</p>
      </section>
      <div className={styles.delete}>
        <DeletePersonButton person={person} />
      </div>
    </aside>
  )
}

/** "Today", "1 day ago", "3 days ago": counted in calendar days, as the canvas does. */
function lastContactLabel(value: string, now: Date): string {
  const ago = dateAgo(todayIsoDate(parseDateTime(value)), now)
  return ago.charAt(0).toUpperCase() + ago.slice(1)
}

function Details({
  person,
  statusSelect,
  now,
}: {
  person: Person
  statusSelect: ReactNode
  now: Date
}) {
  const headingId = useId()
  const isNewContact = person.status.name === 'new contact'
  const status = STATUS_BY_NAME[person.status.name]
  const added = Math.max(now.getTime() - parseDateTime(person.createdAt).getTime(), 0)

  return (
    <section className={cx(section.card, styles.card, styles.details)} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        Details
      </h2>
      <dl className={styles.facts}>
        <Fact label="Age" value={person.age} empty="Not recorded" />
        <Fact label="Year met" value={person.yearMet} empty="Not recorded" />
        {isNewContact && (
          <Fact
            label="Added"
            value={
              <time dateTime={person.createdAt} title={formatDateTime(person.createdAt)}>
                {humanSpan(added)} ago
              </time>
            }
          />
        )}
        <Fact
          label="Last contact"
          value={
            person.lastContactedAt && (
              <time
                dateTime={person.lastContactedAt}
                title={formatDateTime(person.lastContactedAt)}
              >
                {lastContactLabel(person.lastContactedAt, now)}
              </time>
            )
          }
          empty="None yet"
        />
        <Fact label="Status" value={status ? STATUS_LABELS[status] : person.status.name} />
      </dl>
      {statusSelect}
    </section>
  )
}

function Fact({
  label,
  value,
  empty = '—',
}: {
  label: string
  value: ReactNode
  /** Shown, muted, when there is no value. */
  empty?: string
}) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>
        {value === null || value === undefined || value === '' ? (
          <span className={styles.empty}>{empty}</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

/**
 * For leaving this page for good: the person is gone, or no longer ours.
 * Navigates first, then drops them from the cache, so this page doesn't
 * refetch them on the way out and Back doesn't show stale details.
 */
function useLeavePerson(personId: string) {
  const navigate = useNavigate()
  const client = useApolloClient()
  return () => {
    navigate('/people')
    client.cache.evict({ id: client.cache.identify({ __typename: 'Person', id: personId }) })
    client.cache.gc()
  }
}

/**
 * Any shepherd may remove another, or step back themselves (Remove on their own row), but the
 * API refuses to remove the last one, so with a single shepherd there is nothing to offer here;
 * deleting the person is the way out.
 */
function Shepherds({ person, meId }: { person: Person; meId: string | undefined }) {
  const headingId = useId()
  const canRemove = person.shepherds.length > 1

  return (
    <section
      className={cx(section.card, styles.card, styles.shepherds)}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className={styles.title}>
        Shepherds
      </h2>
      <ul className={styles.shepherdList}>
        {person.shepherds.map((s, i) => {
          const isMe = s.id === meId
          return (
            <li key={s.id} className={styles.shepherd}>
              <Avatar name={s.name} size="sm" tint={avatarTint(i)} />
              <div className={styles.who}>
                <div className={styles.name}>{s.name}</div>
                <div className={styles.role}>{isMe ? 'You' : 'Co-shepherd'}</div>
              </div>
              {canRemove &&
                (isMe ? (
                  <StopShepherdingButton person={person} meId={s.id} />
                ) : (
                  <RemoveShepherdButton person={person} shepherd={s} />
                ))}
            </li>
          )
        })}
      </ul>
      <AddShepherd personId={person.id} shepherdIds={person.shepherds.map((s) => s.id)} />
    </section>
  )
}

function RemoveShepherdButton({
  person,
  shepherd,
}: {
  person: Person
  shepherd: Person['shepherds'][number]
}) {
  // The result's shepherds list is merged into the cached person.
  const [unassignPerson, { loading, error }] = useUnassignPersonMutation()

  return (
    <ConfirmButton
      label="Remove"
      ariaLabel={`Remove ${shepherd.name} as shepherd`}
      title={`Remove ${shepherd.name} as a shepherd?`}
      body={`${firstName(person.name)} will leave ${firstName(shepherd.name)}'s list, and ${firstName(shepherd.name)} will stop seeing their notes and prayer burdens.`}
      confirmLabel="Yes, remove"
      loading={loading}
      error={error}
      onConfirm={() => unassignPerson({ variables: { personId: person.id, userId: shepherd.id } })}
    />
  )
}

/** Remove on your own row: you stop shepherding them, and the page is no longer yours to see. */
function StopShepherdingButton({ person, meId }: { person: Person; meId: string }) {
  const leave = useLeavePerson(person.id)
  const [unassignPerson, { loading, error }] = useUnassignPersonMutation(RELOAD_CONTACT_LISTS)

  return (
    <ConfirmButton
      label="Remove"
      ariaLabel={`Stop shepherding ${person.name}`}
      title={`Stop shepherding ${person.name}?`}
      body="They'll be removed from your list. Their other shepherds keep them."
      confirmLabel="Yes, stop"
      loading={loading}
      error={error}
      onConfirm={async () => {
        await unassignPerson({ variables: { personId: person.id, userId: meId } })
        leave()
      }}
    />
  )
}

function DeletePersonButton({ person }: { person: Person }) {
  const leave = useLeavePerson(person.id)
  const [deletePerson, { loading, error }] = useDeletePersonMutation(RELOAD_CONTACT_LISTS)

  return (
    <ConfirmButton
      label={`Delete ${person.name}`}
      danger
      title={`Delete ${person.name}?`}
      body="This removes them, their milestones, prayer burdens and notes for every shepherd. It can't be undone."
      confirmLabel="Yes, delete"
      loading={loading}
      error={error}
      onConfirm={async () => {
        await deletePerson({ variables: { id: person.id } })
        leave()
      }}
    />
  )
}
