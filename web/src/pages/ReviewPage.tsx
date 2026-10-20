import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  AppHeader,
  Avatar,
  avatarTint,
  Brand,
  Button,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  DueTag,
  InsetNote,
  Meter,
  MilestoneTag,
  PrayerCount,
  StatusPill,
  Stepper,
  StepsPanel,
  type AvatarTint,
} from '../components'
import { cx } from '../components/utils'
import { friendlyMessage } from '../errors'
import { firstName, formatShortDate, humanSpan, parseDateTime, timeAgo } from '../format'
import {
  ContactState,
  useContactAlertsQuery,
  useMeQuery,
  usePersonQuery,
  type ContactAlertsQuery,
  type PersonQuery,
} from '../generated/graphql'
import { loggedContactId, type LoggedPerson } from './contactToast'
import { careDetails } from './HomePage'
import { LogContactForm } from './LogContactForm'
import { STATUS_BY_NAME } from './personStatus'
import styles from './ReviewPage.module.css'

type Summary = ContactAlertsQuery['contactAlerts'][number]
type Person = NonNullable<PersonQuery['person']>

/** What happened to each person in this session. Kept in the page only; a reload starts over. */
type Outcome =
  | {
      kind: 'logged'
      person: LoggedPerson
      /** For Undo on the Finished screen. */
      contactId: string | undefined
      wasNewContact: boolean
      withBurden: boolean
    }
  | { kind: 'skipped' }

/** The card's milestone order (todo decision 2026-10-16). The API sorts them by name. */
const MILESTONE_ORDER = ['baptised', 'joined small group', 'serving', 'leading']

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "14 days overdue". The server sets contactDueAt for every tracked person. */
function overdueBy(dueAt: string, now: Date): string {
  return `${humanSpan(Math.max(now.getTime() - parseDateTime(dueAt).getTime(), 0))} overdue`
}

/**
 * Steps through the people who are overdue for contact (business rule 6), most urgent first,
 * with the Log contact form inline. Skip logs nothing, so the person stays overdue.
 */
export function ReviewPage() {
  // network-only so the queue isn't built from a stale cache; later saves refetch it.
  const { data, loading, error } = useContactAlertsQuery({
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'cache-first',
  })
  const { data: me } = useMeQuery()
  const [queue, setQueue] = useState<Summary[] | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [index, setIndex] = useState(0)
  // Moving to the next step focuses its heading, so screen readers announce who's next.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  // Frozen at first load: each save refetches ContactAlerts, and the person just logged drops
  // out of it, so a live list would shift under the user.
  if (queue === null && data) {
    setQueue(data.contactAlerts.filter((p) => p.contactState === ContactState.Overdue))
  }

  useEffect(() => {
    if (moved.current) headingRef.current?.focus()
    moved.current = false
  }, [index])

  function advance(id: string, outcome: Outcome) {
    setOutcomes((prev) => ({ ...prev, [id]: outcome }))
    moved.current = true
    setIndex((i) => i + 1)
  }

  const finished = queue !== null && queue.length > 0 && index >= queue.length
  const toHome = queue?.length === 0 || finished

  return (
    <div className={styles.page}>
      <AppHeader
        brand={<Brand as={Link} to="/" />}
        actions={
          toHome ? (
            <Link to="/" className={styles.headerLink}>
              Back to Home
            </Link>
          ) : (
            // Phones show just "Exit"; the name stays the same at every width.
            <Button
              as={Link}
              to="/"
              variant="secondary"
              icon={<CloseIcon size={14} />}
              aria-label="Exit review"
            >
              Exit<span className={styles.wideOnly}> review</span>
            </Button>
          )
        }
      />

      {queue === null ? (
        <main className={styles.main}>
          {loading && <p className={styles.muted}>Loading…</p>}
          {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
        </main>
      ) : queue.length === 0 ? (
        // Includes a user with no one assigned yet (business rule 1).
        <main className={styles.narrow}>
          <section className={styles.empty}>
            <h1 className={styles.title}>No one is overdue</h1>
            <p className={styles.muted}>There&apos;s no one to review right now.</p>
            <Button as={Link} to="/">
              Back to Home
            </Button>
          </section>
        </main>
      ) : finished ? (
        <Finished
          queue={queue}
          outcomes={outcomes}
          overdueNow={
            data?.contactAlerts.filter((p) => p.contactState === ContactState.Overdue).length
          }
          headingRef={headingRef}
        />
      ) : (
        <Steps
          queue={queue}
          index={index}
          outcomes={outcomes}
          meId={me?.me.id}
          headingRef={headingRef}
          onLogged={(id, outcome) => advance(id, outcome)}
          onSkip={(id) => advance(id, { kind: 'skipped' })}
        />
      )}
    </div>
  )
}

function Steps({
  queue,
  index,
  outcomes,
  meId,
  headingRef,
  onLogged,
  onSkip,
}: {
  queue: Summary[]
  index: number
  outcomes: Record<string, Outcome>
  meId: string | undefined
  headingRef: Ref<HTMLHeadingElement>
  onLogged: (id: string, outcome: Outcome) => void
  onSkip: (id: string) => void
}) {
  const queueTitleId = useId()
  const now = new Date()
  const total = queue.length
  const current = queue[index]
  const isLast = index === total - 1
  const kinds = queue.map((p) => outcomes[p.id]?.kind)
  const logged = kinds.filter((k) => k === 'logged').length
  const skipped = kinds.filter((k) => k === 'skipped').length
  const upNext = queue.slice(index + 1).filter((p) => !outcomes[p.id])

  return (
    <main className={styles.main}>
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>Review overdue contacts</h1>
          <p className={styles.summary}>
            {isLast && total > 1
              ? `Last one. ${logged} logged, ${skipped} skipped so far.`
              : 'Most urgent first. Log each contact as you go.'}
          </p>
        </div>
        <span className={styles.position}>
          {index + 1} of {total}
        </span>
      </div>

      <Stepper current={index + 1} total={total} outcomes={kinds} />
      {upNext.length > 0 && (
        <p className={cx(styles.upNext, styles.narrowOnly)}>
          Up next: {upNext.map((p) => p.name).join(', ')}
        </p>
      )}

      <div className={styles.layout}>
        <ReviewStep
          // Remounted per person, so the form starts empty.
          key={current.id}
          summary={current}
          tint={avatarTint(index)}
          meId={meId}
          isLast={isLast}
          headingRef={headingRef}
          onLogged={(outcome) => onLogged(current.id, outcome)}
          onSkip={() => onSkip(current.id)}
        />

        <aside className={cx(styles.aside, styles.wideOnly)}>
          <section aria-labelledby={queueTitleId} className={styles.queue}>
            <div className={styles.queueHead}>
              <h2 id={queueTitleId} className={styles.queueTitle}>
                Review queue
              </h2>
              <span className={styles.muted}>{total} overdue</span>
            </div>
            <ol className={styles.queueList}>
              {queue.map((p, i) => {
                const state = i === index ? 'now' : (outcomes[p.id]?.kind ?? 'todo')
                return (
                  <li
                    key={p.id}
                    className={cx(styles.queueRow, styles[state])}
                    aria-current={i === index ? 'step' : undefined}
                  >
                    <Avatar name={p.name} size="sm" tint={avatarTint(i)} />
                    <span className={styles.queueWho}>
                      <span className={styles.queueName}>{p.name}</span>
                      <span className={styles.queueSub}>
                        {state === 'logged' ? 'Contact logged' : overdueBy(p.contactDueAt!, now)}
                      </span>
                    </span>
                    <span className={styles.queueState}>{STATE_WORDS[state]}</span>
                  </li>
                )
              })}
            </ol>
          </section>
          <p className={styles.rules}>
            {isLast
              ? 'Skipped people stay overdue on Home until you contact them.'
              : 'Rules: active people are contacted every 7 days from their last contact. New contacts need a contact within 72 hours of being added, then become Active.'}
          </p>
        </aside>
      </div>
    </main>
  )
}

const STATE_WORDS = { now: 'Now', todo: 'To do', logged: 'Logged', skipped: 'Skipped' }

function ReviewStep({
  summary,
  tint,
  meId,
  isLast,
  headingRef,
  onLogged,
  onSkip,
}: {
  summary: Summary
  tint: AvatarTint
  meId: string | undefined
  isLast: boolean
  headingRef: Ref<HTMLHeadingElement>
  onLogged: (outcome: Outcome) => void
  onSkip: () => void
}) {
  const formId = useId()
  const nameId = useId()
  const logTitleId = useId()
  const [busy, setBusy] = useState(false)
  // For the burden text and milestones, which summaries don't carry.
  const { data, error } = usePersonQuery({ variables: { id: summary.id } })
  const person = data?.person
  const now = new Date()
  const first = firstName(summary.name)
  const met = [summary.age, summary.yearMet && `met ${summary.yearMet}`].filter(Boolean).join(' · ')
  const others = summary.shepherds.filter((s) => s.id !== meId)

  return (
    <div className={styles.step}>
      <article aria-labelledby={nameId} className={styles.person}>
        <div className={styles.personHead}>
          <Avatar name={summary.name} size="xl" tint={tint} className={styles.avatar} />
          <div className={styles.who}>
            <h2 id={nameId} ref={headingRef} tabIndex={-1} className={styles.name}>
              {summary.name}
            </h2>
            <div className={styles.facts}>
              <StatusPill status={STATUS_BY_NAME[summary.status.name] ?? 'active'} />
              {met && <span>{capitalize(met)}</span>}
              {meId && (
                <span>
                  {others.length > 0
                    ? `Shared with ${others.map((s) => s.name).join(', ')}`
                    : 'Just you'}
                </span>
              )}
            </div>
          </div>
          <DueTag tone="overdue" className={styles.due}>
            {overdueBy(summary.contactDueAt!, now)}
          </DueTag>
        </div>

        {person ? (
          <PersonDetails person={person} now={now} />
        ) : error ? (
          <Alert variant="inline">{friendlyMessage(error)}</Alert>
        ) : (
          <p className={styles.muted}>Loading…</p>
        )}
      </article>

      <section aria-labelledby={logTitleId} className={styles.log}>
        <h3 id={logTitleId} className={styles.logTitle}>
          Log contact
        </h3>
        {summary.status.name === 'new contact' && (
          <StepsPanel headingLevel={4} items={newContactSteps(person?.createdAt, summary)} />
        )}
        <LogContactForm
          id={formId}
          person={summary}
          onBusyChange={setBusy}
          onSaved={(saved, wasNewContact, { withBurden }) =>
            onLogged({
              kind: 'logged',
              person: saved,
              contactId: loggedContactId(saved),
              wasNewContact,
              withBurden,
            })
          }
        />
        {/* A white bar fixed to the bottom of the screen on phones. */}
        <div className={styles.actions}>
          <Button
            type="submit"
            form={formId}
            disabled={busy}
            icon={<CheckIcon size={16} strokeWidth={2} />}
          >
            {busy ? 'Saving…' : 'Log contact'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onSkip}>
            Skip for now
          </Button>
          <Link to={`/people/${summary.id}`} className={cx(styles.open, styles.wideOnly)}>
            Open {first}&apos;s page
            <ChevronRightIcon />
          </Link>
        </div>
        <p className={cx(styles.help, !isLast && styles.wideOnly)}>
          {isLast
            ? 'This is the last person. A summary comes next.'
            : `Skipping logs nothing. ${first} stays overdue on Home.`}
        </p>
      </section>
    </div>
  )
}

/** The meter, last note, newest burden and milestones, from the Person query. */
function PersonDetails({ person, now }: { person: Person; now: Date }) {
  const milestonesId = useId()
  const care = careDetails(person, 'overdue', now)
  // The meter counts from the last contact unless a status move restarted the clock after it.
  const fromLast =
    person.lastContactedAt &&
    parseDateTime(person.contactClockStart!) <= parseDateTime(person.lastContactedAt)
  const latest = person.latestComment
  const burdens = person.prayerBurdens
    .filter((b) => !b.releasedDate)
    .sort((a, b) => parseDateTime(b.createdAt).getTime() - parseDateTime(a.createdAt).getTime())
  const recorded = new Set(person.milestones.map((m) => m.milestone.name))

  // A person may have no notes, burdens or milestones (business rules 2, 3 and 5).
  return (
    <>
      <Meter
        tone="danger"
        {...care.meter}
        detail={fromLast ? formatShortDate(person.lastContactedAt!) : undefined}
      />
      <div className={styles.insets}>
        <InsetNote
          label={latest ? `Last note, ${timeAgo(latest.createdAt, now)}` : 'Last note'}
          className={styles.inset}
        >
          {latest ? latest.content : <span className={styles.muted}>No notes yet.</span>}
        </InsetNote>
        <InsetNote label="Prayer burden" className={styles.inset}>
          {burdens.length > 0 ? (
            <PrayerCount count={burdens.length} className={styles.burden}>
              <span>
                {burdens[0].content}
                {burdens.length > 1 && (
                  <span className={styles.muted}> +{burdens.length - 1} more</span>
                )}
              </span>
            </PrayerCount>
          ) : (
            <span className={styles.muted}>No active prayer burdens yet.</span>
          )}
        </InsetNote>
        {recorded.size === 0 && (
          <InsetNote label="Milestones" className={styles.inset}>
            <span className={styles.muted}>None recorded yet.</span>
          </InsetNote>
        )}
      </div>
      {recorded.size > 0 && (
        <section aria-labelledby={milestonesId}>
          <h3 id={milestonesId} className={styles.label}>
            Milestones
          </h3>
          <div className={styles.tags}>
            {MILESTONE_ORDER.map((name) => (
              <MilestoneTag key={name} done={recorded.has(name)}>
                {capitalize(name)}
              </MilestoneTag>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function newContactSteps(createdAt: string | undefined, summary: Summary) {
  const step = (title: string, detail: string) => (
    <span>
      <span className={styles.stepTitle}>{title}</span>
      <span className={styles.stepDetail}>{detail}</span>
    </span>
  )
  const added = createdAt ? `${formatShortDate(createdAt)}. ` : ''
  return [
    step(
      'Added as a New contact',
      `${added}Contact was due by ${formatShortDate(summary.contactDueAt!)}`,
    ),
    step('Log a contact', 'Now: date, what you talked about'),
    step('Becomes Active', 'Then a contact within 7 days of the last'),
  ]
}

/** The summary after the last step. The lists of logged and skipped people come next. */
function Finished({
  queue,
  outcomes,
  overdueNow,
  headingRef,
}: {
  queue: Summary[]
  outcomes: Record<string, Outcome>
  /** From ContactAlerts, which each save refetches. */
  overdueNow: number | undefined
  headingRef: Ref<HTMLHeadingElement>
}) {
  const total = queue.length
  const logged = queue.filter((p) => outcomes[p.id]?.kind === 'logged').length
  const skipped = queue.filter((p) => outcomes[p.id]?.kind === 'skipped').length

  return (
    <main className={styles.narrow}>
      <div className={styles.done}>
        <div aria-hidden="true" className={styles.tick}>
          <CheckIcon size={30} />
        </div>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          Review finished
        </h1>
        <p className={styles.doneSummary}>
          {logged} of {countOf(total, 'contact', 'contacts')} logged.
          {skipped > 0 && ` ${skipped} ${skipped === 1 ? 'is' : 'are'} still overdue.`}
        </p>
      </div>
      <div className={styles.doneActions}>
        <Button as={Link} to="/">
          Back to Home
        </Button>
        {overdueNow !== undefined && (
          <p className={styles.muted}>
            {overdueNow === 0
              ? 'Home now shows no one overdue.'
              : `Home now shows ${countOf(overdueNow, 'person', 'people')} overdue.`}
          </p>
        )}
      </div>
    </main>
  )
}
