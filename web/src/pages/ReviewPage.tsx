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
  ChevronLeftIcon,
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
  type MeterTone,
} from '../components'
import { cx } from '../components/utils'
import { errorCode, friendlyMessage } from '../errors'
import { firstName, formatShortDate, humanSpan, parseDateTime, timeAgo } from '../format'
import {
  ContactState,
  useContactAlertsQuery,
  useDeleteContactMutation,
  useMeQuery,
  usePersonQuery,
  type ContactAlertsQuery,
  type PersonQuery,
} from '../generated/graphql'
import { loggedContactId, RELOAD_CONTACT_LISTS, type LoggedPerson } from './contactToast'
import { careDetails } from './HomePage'
import { LogContactForm } from './LogContactForm'
import { STATUS_BY_NAME } from './personStatus'
import styles from './ReviewPage.module.css'

type Summary = ContactAlertsQuery['contactAlerts'][number]
type Person = NonNullable<PersonQuery['person']>

type Logged = {
  kind: 'logged'
  person: LoggedPerson
  /** For Undo. */
  contactId: string | undefined
  wasNewContact: boolean
  withBurden: boolean
}

/**
 * What happened to each person in this session. Kept in the page only; a reload starts over.
 * Stale: no longer overdue when their step came up (another shepherd's contact, or a status
 * move), so neither logged nor skipped. Undo clears the outcome.
 */
type Outcome = Logged | { kind: 'skipped' } | { kind: 'stale' }

/** The card's milestone order (todo decision 2026-10-16). The API sorts them by name. */
const MILESTONE_ORDER = ['baptised', 'joined small group', 'serving', 'leading']

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  const rest = { ...record }
  delete rest[id]
  return rest
}

/** "14 days overdue". The server sets contactDueAt for every tracked person. */
function overdueBy(dueAt: string, now: Date): string {
  return `${humanSpan(Math.max(now.getTime() - parseDateTime(dueAt).getTime(), 0))} overdue`
}

/** "Contact logged · comment added", on Finished and on a logged step. */
function loggedDetail({ person, wasNewContact, withBurden }: Logged): string {
  const parts = ['Contact logged']
  // Any contact for a new contact is their follow-up, which makes them active (business rule 6).
  if (wasNewContact && person.status.name === 'active') {
    parts.push(
      person.contactDueAt
        ? `now Active, next contact due ${formatShortDate(person.contactDueAt)}`
        : 'now Active',
    )
    if (withBurden) parts.push('prayer burden added')
  } else {
    parts.push(withBurden ? 'comment and prayer burden added' : 'comment added')
  }
  return parts.join(' · ')
}

/** Why there's nothing to log for someone who was overdue when the review started. */
function staleNote(person: Person, now: Date): string {
  const first = firstName(person.name)
  if (person.contactState === ContactState.NotTracked) return `${first} isn't tracked any more.`
  // A status move after the last contact restarted the clock, so the contact isn't why.
  const contacted =
    person.lastContactedAt &&
    parseDateTime(person.lastContactedAt) >= parseDateTime(person.contactClockStart!)
  return contacted
    ? `${first} was contacted ${timeAgo(person.lastContactedAt!, now)} and isn't overdue any more.`
    : `${first} isn't overdue any more.`
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
  const [deleteContact] = useDeleteContactMutation(RELOAD_CONTACT_LISTS)
  const [queue, setQueue] = useState<Summary[] | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [index, setIndex] = useState(0)
  // Review again from Finished: the step after it is Finished again.
  const [again, setAgain] = useState(false)
  // Changing step, or an Undo, focuses the heading so screen readers announce it.
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
  })

  function go(to: number) {
    moved.current = true
    setIndex(to)
  }

  function next() {
    go(again ? queue!.length : index + 1)
    setAgain(false)
  }

  function advance(id: string, outcome: Outcome) {
    setOutcomes((prev) => ({ ...prev, [id]: outcome }))
    next()
  }

  function reviewAgain(id: string) {
    setAgain(true)
    go(queue!.findIndex((p) => p.id === id))
  }

  /** Deleted or unassigned since the review started: left out without a word. */
  function drop(id: string) {
    moved.current = true
    setQueue((q) => q && q.filter((p) => p.id !== id))
    setOutcomes((prev) => without(prev, id))
    // Otherwise the next person slides into this index.
    if (again) {
      setAgain(false)
      setIndex(queue!.length)
    }
  }

  /** Deleting the contact also moves a follow-up back to new contact on the server. */
  async function undo(id: string, contactId: string) {
    await deleteContact({ variables: { id: contactId } })
    moved.current = true
    setOutcomes((prev) => without(prev, id))
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
          overdueNow={data?.contactAlerts.filter((p) => p.contactState === ContactState.Overdue)}
          headingRef={headingRef}
          onUndo={undo}
          onReviewAgain={reviewAgain}
        />
      ) : (
        <Steps
          queue={queue}
          index={index}
          again={again}
          outcomes={outcomes}
          meId={me?.me.id}
          headingRef={headingRef}
          onLogged={(id, outcome) => advance(id, outcome)}
          onSkip={(id) => advance(id, { kind: 'skipped' })}
          onStale={(id) => advance(id, { kind: 'stale' })}
          onNext={next}
          onPrevious={() => go(index - 1)}
          onMissing={drop}
          onUndo={undo}
        />
      )}
    </div>
  )
}

function Steps({
  queue,
  index,
  again,
  outcomes,
  meId,
  headingRef,
  onLogged,
  onSkip,
  onStale,
  onNext,
  onPrevious,
  onMissing,
  onUndo,
}: {
  queue: Summary[]
  index: number
  /** Reviewing a skipped person again from Finished, which comes back next. */
  again: boolean
  outcomes: Record<string, Outcome>
  meId: string | undefined
  headingRef: Ref<HTMLHeadingElement>
  onLogged: (id: string, outcome: Outcome) => void
  onSkip: (id: string) => void
  onStale: (id: string) => void
  onNext: () => void
  onPrevious: () => void
  onMissing: (id: string) => void
  onUndo: (id: string, contactId: string) => Promise<void>
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
  const previous = index > 0 && !again ? queue[index - 1] : undefined
  const previousButton = previous && (
    <Button variant="text" icon={<ChevronLeftIcon />} onClick={onPrevious}>
      Previous: {previous.name}
    </Button>
  )

  return (
    <main className={styles.main}>
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>Review overdue contacts</h1>
          <p className={styles.summary}>
            {isLast && total > 1 && !again
              ? `Last one. ${logged} logged, ${skipped} skipped so far.`
              : 'Most urgent first. Log each contact as you go.'}
          </p>
        </div>
        <div className={styles.titleSide}>
          {previousButton && <span className={styles.wideOnly}>{previousButton}</span>}
          <span className={styles.position}>
            {index + 1} of {total}
          </span>
        </div>
      </div>

      <Stepper
        current={index + 1}
        total={total}
        outcomes={kinds.map((k) => (k === 'stale' ? undefined : k))}
      />
      {previousButton && <span className={styles.narrowOnly}>{previousButton}</span>}
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
          outcome={outcomes[current.id]}
          tint={avatarTint(index)}
          meId={meId}
          summaryNext={isLast || again}
          headingRef={headingRef}
          onLogged={(outcome) => onLogged(current.id, outcome)}
          onSkip={() => onSkip(current.id)}
          onStale={() => onStale(current.id)}
          onNext={onNext}
          onMissing={() => onMissing(current.id)}
          onUndo={(contactId) => onUndo(current.id, contactId)}
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
                        {state === 'logged'
                          ? 'Contact logged'
                          : state === 'stale'
                            ? 'Nothing to log'
                            : overdueBy(p.contactDueAt!, now)}
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

const STATE_WORDS = {
  now: 'Now',
  todo: 'To do',
  logged: 'Logged',
  skipped: 'Skipped',
  stale: 'Not overdue',
}

function ReviewStep({
  summary,
  outcome,
  tint,
  meId,
  summaryNext,
  headingRef,
  onLogged,
  onSkip,
  onStale,
  onNext,
  onMissing,
  onUndo,
}: {
  summary: Summary
  outcome: Outcome | undefined
  tint: AvatarTint
  meId: string | undefined
  /** The last step, or Review again: Finished comes next. */
  summaryNext: boolean
  headingRef: Ref<HTMLHeadingElement>
  onLogged: (outcome: Outcome) => void
  onSkip: () => void
  onStale: () => void
  onNext: () => void
  onMissing: () => void
  onUndo: (contactId: string) => Promise<void>
}) {
  const formId = useId()
  const nameId = useId()
  const logTitleId = useId()
  const [busy, setBusy] = useState(false)
  // For the burden text and milestones, which summaries don't carry. It also says whether
  // they're still overdue: the contact state is the person's, so another shepherd's contact
  // or a status move can clear it mid-review (business rule 6).
  const { data, error } = usePersonQuery({ variables: { id: summary.id } })
  const person = data?.person
  const missing = (data !== undefined && !person) || errorCode(error) === 'NOT_FOUND'
  useEffect(() => {
    if (missing) onMissing()
  }, [missing, onMissing])
  const now = new Date()
  const first = firstName(summary.name)
  const met = [summary.age, summary.yearMet && `met ${summary.yearMet}`].filter(Boolean).join(' · ')
  const others = summary.shepherds.filter((s) => s.id !== meId)

  let log
  if (outcome?.kind === 'logged') {
    // Back here with Previous (decision Q4): no second contact, but the first can be undone.
    log = (
      <>
        <h3 id={logTitleId} className={styles.logTitle}>
          Contact logged
        </h3>
        <p className={styles.note}>{loggedDetail(outcome)}</p>
        <div className={styles.actions}>
          <Button onClick={onNext}>Next</Button>
          {outcome.contactId && (
            <UndoButton
              name={summary.name}
              className={styles.stepUndo}
              onUndo={() => onUndo(outcome.contactId!)}
            />
          )}
        </div>
      </>
    )
  } else if (person && person.contactState !== ContactState.Overdue) {
    log = (
      <>
        <h3 id={logTitleId} className={styles.logTitle}>
          Nothing to log
        </h3>
        <p className={styles.note}>{staleNote(person, now)}</p>
        <div className={styles.actions}>
          <Button onClick={onStale}>Next</Button>
        </div>
      </>
    )
  } else if (person || (error && !missing)) {
    log = (
      <>
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
        <p className={cx(styles.help, !summaryNext && styles.wideOnly)}>
          {summaryNext
            ? 'This is the last person. A summary comes next.'
            : `Skipping logs nothing. ${first} stays overdue on Home.`}
        </p>
      </>
    )
  }

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
          {/* From the snapshot, so not once they're logged or no longer overdue. */}
          {outcome?.kind !== 'logged' &&
            (!person || person.contactState === ContactState.Overdue) && (
              <DueTag tone="overdue" className={styles.due}>
                {overdueBy(summary.contactDueAt!, now)}
              </DueTag>
            )}
        </div>

        {person ? (
          <PersonDetails person={person} now={now} />
        ) : error && !missing ? (
          <Alert variant="inline">{friendlyMessage(error)}</Alert>
        ) : (
          <p className={styles.muted}>Loading…</p>
        )}
      </article>

      {log && (
        <section aria-labelledby={logTitleId} className={styles.log}>
          {log}
        </section>
      )}
    </div>
  )
}

const METER_TONE: Partial<Record<ContactState, MeterTone>> = {
  [ContactState.Overdue]: 'danger',
  [ContactState.DueSoon]: 'warn',
}

/** The meter, last note, newest burden and milestones, from the Person query. */
function PersonDetails({ person, now }: { person: Person; now: Date }) {
  const milestonesId = useId()
  // An untracked person (moved to inactive mid-review) has no contact window to show.
  const tracked = person.contactState !== ContactState.NotTracked
  const care = tracked ? careDetails(person, 'overdue', now) : undefined
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
      {care && (
        <Meter
          tone={METER_TONE[person.contactState] ?? 'ok'}
          {...care.meter}
          detail={fromLast ? formatShortDate(person.lastContactedAt!) : undefined}
        />
      )}
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

/** Undo for a contact logged this session. Unmounts on success, as the row or panel goes. */
function UndoButton({
  name,
  className,
  onUndo,
}: {
  name: string
  className?: string
  onUndo: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string>()
  return (
    <>
      <Button
        variant="text"
        disabled={busy}
        className={className}
        aria-label={`Undo contact logged for ${name}`}
        onClick={() => {
          setBusy(true)
          setFailed(undefined)
          onUndo().catch((e) => {
            setBusy(false)
            setFailed(friendlyMessage(e))
          })
        }}
      >
        {busy ? 'Undoing…' : 'Undo'}
      </Button>
      {failed && (
        <Alert variant="inline" className={styles.undoError}>
          Couldn&apos;t undo. {failed}
        </Alert>
      )}
    </>
  )
}

/** The summary after the last step: who was logged (with Undo) and who is still overdue. */
function Finished({
  queue,
  outcomes,
  overdueNow,
  headingRef,
  onUndo,
  onReviewAgain,
}: {
  queue: Summary[]
  outcomes: Record<string, Outcome>
  /** From ContactAlerts, which each save and Undo refetch. */
  overdueNow: Summary[] | undefined
  headingRef: Ref<HTMLHeadingElement>
  onUndo: (id: string, contactId: string) => Promise<void>
  onReviewAgain: (id: string) => void
}) {
  const loggedId = useId()
  const overdueId = useId()
  const now = new Date()
  const live = new Map(overdueNow?.map((p) => [p.id, p]))
  const tints = new Map(queue.map((p, i) => [p.id, avatarTint(i)]))
  // People who stopped being overdue on their own weren't part of the work.
  const total = queue.filter((p) => outcomes[p.id]?.kind !== 'stale').length
  const logged = queue.flatMap((p) => {
    const outcome = outcomes[p.id]
    return outcome?.kind === 'logged' ? [{ p, outcome }] : []
  })
  // Skipped, or logged and then undone (no outcome) and overdue again.
  const stillOverdue = queue.filter((p) => {
    const kind = outcomes[p.id]?.kind
    return kind === 'skipped' || (kind === undefined && live.has(p.id))
  })
  const s = stillOverdue.length

  return (
    <main className={styles.narrow}>
      <div className={styles.done}>
        <div aria-hidden="true" className={styles.tick}>
          <CheckIcon size={30} />
        </div>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          Review finished
        </h1>
        <p className={styles.doneSummary} aria-live="polite">
          {logged.length} of {countOf(total, 'contact', 'contacts')} logged.
          {s > 0 && ` ${s} ${s === 1 ? 'is' : 'are'} still overdue.`}
        </p>
      </div>

      {logged.length > 0 && (
        <section aria-labelledby={loggedId} className={styles.card}>
          <h2 id={loggedId} className={styles.cardTitle}>
            Logged today
            <span className={cx(styles.count, styles.loggedCount)}>{logged.length}</span>
          </h2>
          <ul className={styles.rows}>
            {logged.map(({ p, outcome }) => (
              <li key={p.id} className={styles.row}>
                <Avatar name={p.name} tint={tints.get(p.id)} className={styles.rowAvatar} />
                <span className={styles.rowWho}>
                  <span className={styles.rowName}>{p.name}</span>
                  <span className={styles.rowDetail}>{loggedDetail(outcome)}</span>
                </span>
                {outcome.contactId && (
                  <UndoButton
                    name={p.name}
                    className={styles.rowUndo}
                    onUndo={() => onUndo(p.id, outcome.contactId!)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s > 0 && (
        <section aria-labelledby={overdueId} className={cx(styles.card, styles.overdueCard)}>
          <h2 id={overdueId} className={styles.cardTitle}>
            Still overdue
            <span className={cx(styles.count, styles.overdueCount)}>{s}</span>
          </h2>
          <ul className={styles.rows}>
            {stillOverdue.map((p) => (
              <li key={p.id} className={styles.row}>
                <Avatar name={p.name} tint={tints.get(p.id)} className={styles.rowAvatar} />
                <span className={styles.rowWho}>
                  <span className={styles.rowName}>{p.name}</span>
                  <span className={styles.rowDetail}>
                    {outcomes[p.id] ? 'Skipped' : 'Contact removed'} ·{' '}
                    {overdueBy((live.get(p.id) ?? p).contactDueAt!, now)}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  className={styles.again}
                  onClick={() => onReviewAgain(p.id)}
                >
                  Review again
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.doneActions}>
        <Button as={Link} to="/">
          Back to Home
        </Button>
        {overdueNow !== undefined && (
          <p className={styles.muted}>
            {overdueNow.length === 0
              ? 'Home now shows no one overdue.'
              : `Home now shows ${countOf(overdueNow.length, 'person', 'people')} overdue.`}
          </p>
        )}
      </div>
    </main>
  )
}
