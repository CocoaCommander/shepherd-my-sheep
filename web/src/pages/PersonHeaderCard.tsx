import { useState, type ReactNode } from 'react'
import { Avatar, Button, StatusPill } from '../components'
import { firstName, humanSpan, parseDateTime } from '../format'
import type { PersonQuery } from '../generated/graphql'
import { ContactPanel } from './ContactPanel'
import styles from './PersonHeaderCard.module.css'
import { EditPersonForm } from './PersonSidebar'
import { STATUS_BY_NAME } from './personStatus'

type Person = NonNullable<PersonQuery['person']>

/** "you", "you and Grace Lin", "you, Grace Lin and Sam Lee": you first, then the others. */
function shepherdNames(shepherds: Person['shepherds'], meId: string | undefined): string {
  const others = shepherds.filter((s) => s.id !== meId).map((s) => s.name)
  const names = shepherds.some((s) => s.id === meId) ? ['you', ...others] : others
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * "34 years old · Met 2020 · Shepherded by you and Grace Lin". Phones get the short form,
 * "34 · Met 2020", so the parts they drop are wrapped for the stylesheet to hide, each with
 * its own separator.
 */
function Subtitle({ person, meId, now }: { person: Person; meId: string | undefined; now: Date }) {
  const parts: ReactNode[] = []
  const sep = () => (parts.length > 0 ? ' · ' : '')
  if (person.age !== null) {
    parts.push(
      `${person.age}`,
      <span key="years" className={styles.wideOnly}>
        {' '}
        years old
      </span>,
    )
  }
  if (person.yearMet !== null) parts.push(`${sep()}Met ${person.yearMet}`)
  if (person.status.name === 'new contact') {
    const added = parseDateTime(person.createdAt).getTime()
    parts.push(`${sep()}Added ${humanSpan(Math.max(now.getTime() - added, 0))} ago`)
  }
  const shepherds = shepherdNames(person.shepherds, meId)
  if (shepherds) {
    parts.push(
      <span key="by" className={styles.wideOnly}>
        {sep()}Shepherded by {shepherds}
      </span>,
    )
  }

  return <p className={styles.subtitle}>{parts}</p>
}

/**
 * The top of the Person page: who they are, where they stand against the contact rule, and
 * Edit details. On phones the actions move under the contact panel and gain "Add note".
 */
export function PersonHeaderCard({
  person,
  meId,
  notesFieldId,
  onLogContact,
  now = new Date(),
}: {
  person: Person
  meId: string | undefined
  /** The Notes box, which phones' "Add note" moves focus to. */
  notesFieldId: string
  onLogContact: () => void
  now?: Date
}) {
  const [editing, setEditing] = useState(false)

  return (
    <section className={styles.card} aria-labelledby="person-name">
      <div className={styles.identity}>
        <Avatar name={person.name} size="xl" />
        <div className={styles.who}>
          <div className={styles.nameRow}>
            <h1 id="person-name" className={styles.name}>
              {person.name}
            </h1>
            <StatusPill status={STATUS_BY_NAME[person.status.name] ?? 'active'} />
          </div>
          <Subtitle person={person} meId={meId} now={now} />
        </div>
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          className={styles.narrowOnly}
          aria-label={`Add note about ${firstName(person.name)}`}
          onClick={() => document.getElementById(notesFieldId)?.focus()}
        >
          Add note
        </Button>
        <Button variant="secondary" onClick={() => setEditing(true)} disabled={editing}>
          Edit details
        </Button>
      </div>

      <div className={styles.contact}>
        <ContactPanel person={person} now={now} onLogContact={onLogContact} />
      </div>

      {editing && (
        // Mounted fresh each time, so it always starts from the saved values.
        <div className={styles.edit}>
          <EditPersonForm person={person} onDone={() => setEditing(false)} />
        </div>
      )}
    </section>
  )
}
