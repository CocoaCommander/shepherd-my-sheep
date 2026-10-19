import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  avatarTint,
  Button,
  CareCard,
  CountPill,
  PlusIcon,
  StatTile,
  Toast,
  type CareUrgency,
  type CountTone,
  type PersonStatus,
} from '../components'
import { quickContact } from '../contacts'
import { friendlyMessage } from '../errors'
import { humanSpan, isToday, parseDateTime } from '../format'
import {
  ContactAlertsDocument,
  ContactState,
  MyPeopleDocument,
  useDeleteContactMutation,
  useLogContactMutation,
  useMeQuery,
  useMyPeopleQuery,
  type PersonSummaryFragment,
} from '../generated/graphql'
import { Header } from './Header'
import styles from './HomePage.module.css'

type Person = PersonSummaryFragment

const HOUR = 3_600_000
const DAY = 24 * HOUR

// The contact windows from business rule 6, as the person_contact_state view applies them.
const WINDOW = { active: 7 * DAY, new: 72 * HOUR }

const STATUS_BY_NAME: Record<string, PersonStatus> = {
  'new contact': 'new',
  active: 'active',
  inactive: 'inactive',
  'lost contact': 'lost',
}

const reloadPeople = {
  refetchQueries: [{ query: MyPeopleDocument }, { query: ContactAlertsDocument }],
}

const isNewContact = (person: Person) => person.status.name === 'new contact'

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

/** What the care card shows for a tracked person, worked out from their due time. */
export function careDetails(person: Person, urgency: CareUrgency, now: Date = new Date()) {
  const isNew = isNewContact(person)
  const window = isNew ? WINDOW.new : WINDOW.active
  const due = parseDateTime(person.contactDueAt!).getTime()
  // The clock starts at the last contact, or when they were added if there's none.
  const sinceStart = now.getTime() - (due - window)
  const last = person.lastContactedAt ? parseDateTime(person.lastContactedAt).getTime() : null

  const meterLabel =
    last === null ? 'No contact logged yet' : `${since(last, now)} since last contact`
  const goal = isNew ? 'Follow up within 72 hours' : 'Goal: every 7 days'

  let dueLabel: string
  if (urgency === 'overdue') {
    dueLabel = `${humanSpan(now.getTime() - due)} overdue`
  } else if (urgency === 'soon') {
    dueLabel = `Due in ${humanSpan(due - now.getTime())}`
  } else {
    dueLabel = 'On track'
  }

  // Adding someone is their first contact, so any contact logged for a new contact is their
  // follow-up, which makes them active.
  const action = isNew ? 'Log follow-up' : 'Contacted today'
  const isFollowUp = isNew

  return {
    meter: { value: sinceStart, max: window, label: meterLabel, goal },
    dueLabel,
    action,
    isFollowUp,
    aside: isFollowUp ? 'Becomes a regular contact' : undefined,
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

type Confirmation = { message: string; undoId: string | null }

export function HomePage() {
  const { data: me } = useMeQuery()
  const { data, loading, error } = useMyPeopleQuery()
  const [logContact, logState] = useLogContactMutation(reloadPeople)
  const [deleteContact] = useDeleteContactMutation(reloadPeople)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Up for 20 seconds so everyone can reach Undo (WCAG 2.2.1).
  useEffect(() => {
    clearTimeout(timer.current)
    if (confirmation) timer.current = setTimeout(() => setConfirmation(null), 20_000)
    return () => clearTimeout(timer.current)
  }, [confirmation])

  async function log(person: Person, isFollowUp: boolean) {
    setPendingId(person.id)
    try {
      const result = await logContact({ variables: { input: quickContact(person.id) } })
      // contacts are newest first, so [0] is the one just logged. A follow-up can't be undone
      // from here, since deleting it wouldn't undo the move to active.
      const logged = result.data?.logContact.contacts[0]?.id ?? null
      setConfirmation({
        message: isFollowUp
          ? `Follow-up logged. ${person.name} is now active.`
          : `Contact with ${person.name} logged.`,
        undoId: isFollowUp ? null : logged,
      })
    } catch {
      // Shown from the mutation's `error` below.
    } finally {
      setPendingId(null)
    }
  }

  async function undo() {
    if (!confirmation?.undoId) return
    try {
      await deleteContact({ variables: { id: confirmation.undoId } })
      setConfirmation({ message: 'Contact removed.', undoId: null })
    } catch {
      setConfirmation({ message: 'Could not undo. Try again from their page.', undoId: null })
    }
  }

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
        {logState.error && <Alert variant="inline">{friendlyMessage(logState.error)}</Alert>}

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
                  <Button as="a" href="#overdue" variant="danger" className={styles.bannerAction}>
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
                          busy={pendingId === person.id}
                          onLog={log}
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

      {confirmation && (
        <Toast
          floating
          className={styles.toast}
          message={confirmation.message}
          actionLabel={confirmation.undoId ? 'Undo' : undefined}
          onAction={confirmation.undoId ? undo : undefined}
        />
      )}
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
  busy,
  onLog,
}: {
  person: Person
  urgency: CareUrgency
  tintIndex: number
  now: Date
  busy: boolean
  onLog: (person: Person, isFollowUp: boolean) => void
}) {
  const care = careDetails(person, urgency, now)
  // As on the person page: an active person contacted today needs nothing more today.
  const contactedToday =
    !isNewContact(person) && !!person.lastContactedAt && isToday(person.lastContactedAt, now)
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
          {!contactedToday && (
            <Button
              variant={urgency === 'overdue' ? 'danger' : 'primary'}
              className={styles.primaryAction}
              disabled={busy}
              onClick={() => onLog(person, care.isFollowUp)}
            >
              {busy ? 'Saving…' : care.action}
            </Button>
          )}
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
      aside={contactedToday ? 'Contacted today' : care.aside}
    />
  )
}
