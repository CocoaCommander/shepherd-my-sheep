import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  avatarTint,
  Button,
  CareCard,
  CountPill,
  PlusIcon,
  StatTile,
  type CareUrgency,
  type CountTone,
} from '../components'
import { friendlyMessage } from '../errors'
import { humanSpan, parseDateTime } from '../format'
import {
  ContactState,
  useMeQuery,
  useMyPeopleQuery,
  type MyPeopleQuery,
} from '../generated/graphql'
import { useLogContactToast } from './contactToast'
import { contactWindow, contactWindowLabel } from './contactWindow'
import { Header } from './Header'
import styles from './HomePage.module.css'
import { LogContactDialog } from './LogContactDialog'
import { STATUS_BY_NAME } from './personStatus'

type Person = MyPeopleQuery['myPeople'][number]

const isNewContact = (person: Pick<Person, 'status'>) => person.status.name === 'new contact'

/** "21 days", "5 hours": how long ago a time was. */
const since = (time: number, now: Date) => humanSpan(Math.max(now.getTime() - time, 0))

function byDueAt(a: Person, b: Person) {
  return parseDateTime(a.contactDueAt!).getTime() - parseDateTime(b.contactDueAt!).getTime()
}

/** People split by contact state, each group most urgent first. Any group may be empty. */
export function groupByContactState(people: readonly Person[]) {
  const tracked = (state: ContactState) =>
    people.filter((p) => p.contactState === state && p.contactDueAt).sort(byDueAt)
  return {
    overdue: tracked(ContactState.Overdue),
    soon: tracked(ContactState.DueSoon),
    ok: tracked(ContactState.OnTrack),
    // Inactive and lost contact people aren't held to a cadence.
    notTracked: people.filter((p) => p.contactState === ContactState.NotTracked),
  }
}

/** What the care card shows for a tracked person, worked out from their contact window. */
export function careDetails(
  person: Pick<
    Person,
    'status' | 'contactClockStart' | 'contactDueAt' | 'lastContactedAt' | 'createdAt'
  >,
  urgency: CareUrgency,
  now: Date = new Date(),
) {
  const isNew = isNewContact(person)
  // careDetails is only called for tracked people, who always have a window.
  const clock = contactWindow(person, now)!
  const meterLabel = contactWindowLabel(clock, isNew)
  const goal = isNew ? 'Follow up within 72 hours' : 'Goal: every 7 days'

  const dueIn = clock.max - clock.value
  let dueLabel: string
  if (urgency === 'overdue') {
    dueLabel = `${humanSpan(-dueIn)} overdue`
  } else if (urgency === 'soon') {
    dueLabel = `Due in ${humanSpan(dueIn)}`
  } else {
    dueLabel = 'On track'
  }

  return {
    meter: { value: clock.value, max: clock.max, label: meterLabel, goal },
    dueLabel,
    // Adding someone is their first contact, so any contact logged for a new contact is their
    // follow-up, which makes them active.
    aside: isNew ? 'Becomes a regular contact' : undefined,
  }
}

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The banner's second line: the longest gone, plus anyone never contacted. */
function overdueSummary(overdue: Person[], now: Date): string {
  const [first] = overdue
  const lines = [
    first.lastContactedAt
      ? `${first.name} has gone ${since(parseDateTime(first.lastContactedAt).getTime(), now)}.`
      : `${first.name} has not been contacted yet.`,
  ]
  const neverContacted = overdue.find((p) => p !== first && !p.lastContactedAt)
  if (neverContacted) lines.push(`${neverContacted.name} has not been contacted yet.`)
  return lines.join(' ')
}

export function HomePage() {
  const { data: me } = useMeQuery()
  const { data, loading, error } = useMyPeopleQuery()
  // Who the Log contact dialog is open for; it mounts only while someone is chosen.
  const [logging, setLogging] = useState<Person | null>(null)
  const { showLogged, toastElement } = useLogContactToast({
    floating: true,
    className: styles.toast,
  })

  const now = new Date()
  const firstName = me?.me.name.split(/\s+/)[0]
  const people = data?.myPeople ?? []
  const groups = groupByContactState(people)
  const trackedCount = groups.overdue.length + groups.soon.length + groups.ok.length

  const sections: Array<{
    id: string
    urgency: CareUrgency
    title: string
    hint: string
    tone: CountTone
    people: Person[]
  }> = [
    {
      id: 'overdue',
      urgency: 'overdue',
      title: 'Needs contact now',
      hint: 'Overdue, most urgent first',
      tone: 'danger',
      people: groups.overdue,
    },
    {
      id: 'soon',
      urgency: 'soon',
      title: 'Coming up',
      hint: 'Due within 2 days',
      tone: 'warn',
      people: groups.soon,
    },
    {
      id: 'ok',
      urgency: 'ok',
      title: 'On track',
      hint: 'Contacted within their window',
      tone: 'ok',
      people: groups.ok,
    },
  ]

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <div className={styles.intro}>
          <div>
            <h1 className={styles.title}>
              {greeting(now)}
              {firstName && `, ${firstName}`}
            </h1>
            <p className={styles.date}>
              {now.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          </div>
          <Button
            as={Link}
            to="/people/new"
            variant="secondary"
            icon={<PlusIcon />}
            className={styles.addPerson}
          >
            Add person
          </Button>
        </div>

        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}

        {data && people.length === 0 && (
          // A new user has no one assigned yet (business rule 1).
          <section className={styles.empty}>
            <h2 className={styles.sectionTitle}>No one is assigned to you yet</h2>
            <p className={styles.muted}>
              Add the people you shepherd and this page will show who needs contacting.
            </p>
            <Button as={Link} to="/people/new" icon={<PlusIcon />}>
              Add person
            </Button>
          </section>
        )}

        {data && people.length > 0 && (
          <>
            {groups.overdue.length > 0 ? (
              <Alert
                title={`${groups.overdue.length} ${groups.overdue.length === 1 ? 'person is' : 'people are'} overdue for contact`}
                action={
                  <Button as={Link} to="/review" variant="danger" className={styles.bannerAction}>
                    Review now
                  </Button>
                }
              >
                {overdueSummary(groups.overdue, now)}
              </Alert>
            ) : (
              trackedCount > 0 && (
                <Alert variant="success">
                  No one is overdue. Everyone has been contacted within their window.
                </Alert>
              )
            )}

            <div className={styles.stats}>
              <StatTile
                {...statLink('overdue', groups.overdue.length)}
                tone="danger"
                count={groups.overdue.length}
                label="Overdue"
                rule="Past their contact goal"
              />
              <StatTile
                {...statLink('soon', groups.soon.length)}
                tone="warn"
                count={groups.soon.length}
                label="Coming up"
                rule="Due within 2 days"
              />
              <StatTile
                {...statLink('ok', groups.ok.length)}
                tone="ok"
                count={groups.ok.length}
                label="On track"
                rule="Within their window"
              />
              <StatTile
                as={Link}
                to="/people"
                count={groups.notTracked.length}
                label="Not tracked"
                rule="Inactive or lost"
              />
            </div>

            {sections.map(
              (section) =>
                section.people.length > 0 && (
                  <section
                    key={section.id}
                    id={section.id}
                    aria-labelledby={`${section.id}-title`}
                    className={styles.section}
                  >
                    <div className={styles.sectionHead}>
                      <h2 id={`${section.id}-title`} className={styles.sectionTitle}>
                        {section.title}
                      </h2>
                      <CountPill count={section.people.length} tone={section.tone} />
                      <span className={styles.hint}>{section.hint}</span>
                    </div>
                    <div className={section.urgency === 'overdue' ? styles.gridWide : styles.grid}>
                      {section.people.map((person, i) => (
                        <PersonCare
                          key={person.id}
                          person={person}
                          urgency={section.urgency}
                          tintIndex={i}
                          now={now}
                          onLogContact={setLogging}
                        />
                      ))}
                    </div>
                  </section>
                ),
            )}

            {groups.notTracked.length > 0 && (
              <div className={styles.notTracked}>
                <p>
                  <strong>Not tracked: {groups.notTracked.length}</strong>
                  <span className={styles.muted}>
                    {' · '}
                    {groups.notTracked.map((p) => `${p.name} (${p.status.name})`).join(', ')}
                  </span>
                </p>
                <Link to="/people" className={styles.link}>
                  View all people
                </Link>
              </div>
            )}
          </>
        )}
      </main>

      {/* Saving and Undo reload MyPeople, which moves the card to its new group. */}
      {logging && (
        <LogContactDialog
          person={logging}
          open
          onClose={() => setLogging(null)}
          onSaved={(saved, wasNewContact) => {
            setLogging(null)
            showLogged(saved, wasNewContact)
          }}
        />
      )}
      {toastElement}
    </div>
  )
}

/** A stat tile links to its section; with no one in it there's nothing to jump to. */
function statLink(id: string, count: number) {
  return count > 0 ? { href: `#${id}` } : { as: 'div' as const }
}

function PersonCare({
  person,
  urgency,
  tintIndex,
  now,
  onLogContact,
}: {
  person: Person
  urgency: CareUrgency
  tintIndex: number
  now: Date
  onLogContact: (person: Person) => void
}) {
  const care = careDetails(person, urgency, now)
  const profile = `/people/${person.id}`

  return (
    <CareCard
      name={person.name}
      renderName={(name) => <Link to={profile}>{name}</Link>}
      status={STATUS_BY_NAME[person.status.name] ?? 'active'}
      urgency={urgency}
      dueLabel={care.dueLabel}
      meter={care.meter}
      avatarTint={avatarTint(tintIndex)}
      actions={
        <>
          <Button
            variant={urgency === 'overdue' ? 'danger' : 'primary'}
            className={styles.primaryAction}
            aria-label={`Log contact with ${person.name}`}
            onClick={() => onLogContact(person)}
          >
            Log contact
          </Button>
          <Button
            as={Link}
            to={profile}
            variant="secondary"
            aria-label={`Add note for ${person.name}`}
          >
            Add note
          </Button>
        </>
      }
      aside={care.aside}
    />
  )
}
