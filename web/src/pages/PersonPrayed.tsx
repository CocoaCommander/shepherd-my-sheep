import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Alert, Button, DateField, HeartIcon, initials, TOAST_MS } from '../components'
import { friendlyMessage } from '../errors'
import {
  calendarAgo,
  contactDateToTimestamp,
  differentDays,
  firstName,
  formatShortDate,
  parseDateTime,
  todayIsoDate,
} from '../format'
import {
  useDeletePrayerMutation,
  useRecordPrayerMutation,
  type PersonQuery,
} from '../generated/graphql'
import styles from './PersonPrayed.module.css'

type Person = NonNullable<PersonQuery['person']>
type Prayer = Person['prayers'][number]

/** The history shows this many before "Show N earlier". */
const SHOWN = 3

/** "You" for the caller, "Someone" for a deleted user; lowercase for mid-sentence. */
function prayerAuthor(
  prayer: { prayedBy?: { id: string; name: string } | null },
  meId: string | undefined,
  { lower = false } = {},
) {
  if (!prayer.prayedBy) return lower ? 'someone' : 'Someone'
  if (prayer.prayedBy.id === meId) return lower ? 'you' : 'You'
  return prayer.prayedBy.name
}

/** Recorded on a different day from the one prayed for. */
const isBackDated = (p: Prayer) => differentDays(p.prayedAt, p.createdAt)

/**
 * The canvas's order: by the day prayed, newest first, ties by newest recorded. The API sorts by
 * prayedAt, which puts a back-dated record (12:00 that day) among that day's others by time.
 */
function byPrayedDay(a: Prayer, b: Prayer): number {
  const day = todayIsoDate(parseDateTime(b.prayedAt)).localeCompare(
    todayIsoDate(parseDateTime(a.prayedAt)),
  )
  return day || parseDateTime(b.createdAt).getTime() - parseDateTime(a.createdAt).getTime()
}

/**
 * The Prayer burdens section's prayer box: when the person was last prayed for, Prayed (now) and
 * Another day (back-dated), then the shared history. Praying isn't a contact (business rule 6),
 * and a person with no burdens can still be prayed for (rule 3).
 */
export function PersonPrayed({ person, meId }: { person: Person; meId: string | undefined }) {
  const first = firstName(person.name)
  const [logged, setLogged] = useState<{ id: string; text: string } | null>(null)
  const [backOpen, setBackOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The results carry PersonSummary and PersonActivity, so the cache updates this page.
  const [recordPrayer, recording] = useRecordPrayerMutation()
  const [deletePrayer, undoing] = useDeletePrayerMutation()

  useEffect(() => () => clearTimeout(timer.current), [])

  const showLogged = (shown: { id: string; text: string } | null) => {
    clearTimeout(timer.current)
    setLogged(shown)
    if (shown) timer.current = setTimeout(() => setLogged(null), TOAST_MS)
  }

  /** Records a prayer; prayedAt omitted means now. Returns whether it was saved. */
  async function record(prayedAt?: string): Promise<boolean> {
    if (recording.loading) return false
    undoing.reset()
    const before = new Set(person.prayers.map((p) => p.id))
    try {
      const result = await recordPrayer({
        variables: { personId: person.id, ...(prayedAt && { prayedAt }) },
      })
      // A back-dated record may not be prayers[0]; the new one is the id that wasn't there.
      const added = result.data?.recordPrayer.prayers.find((p) => !before.has(p.id))
      if (added) {
        const on = prayedAt ? ` on ${formatShortDate(added.prayedAt)}` : ''
        showLogged({ id: added.id, text: `Prayer logged for ${first}${on}.` })
      }
      return true
    } catch {
      // Shown from the mutation's `error` below.
      return false
    }
  }

  async function undo() {
    if (!logged || undoing.loading) return
    try {
      await deletePrayer({ variables: { id: logged.id } })
      showLogged(null)
    } catch {
      // Shown from the mutation's `error` below; the message stays so Undo can be retried.
    }
  }

  const error = recording.error ?? undoing.error
  const last = person.lastPrayer

  return (
    <div className={styles.box}>
      <div className={styles.top}>
        <div className={styles.summary}>
          <HeartIcon size={18} className={styles.heart} />
          <div>
            <p className={styles.line}>
              {last
                ? `Last prayed for ${first} ${calendarAgo(last.prayedAt)}`
                : `Nobody has prayed for ${first} yet.`}
            </p>
            <p className={styles.sub}>
              {last
                ? `By ${prayerAuthor(last, meId, { lower: true })} · ${formatShortDate(last.prayedAt)}`
                : `Tap Prayed each time you pray for ${first}. Every shepherd of ${first} sees the same history.`}
            </p>
          </div>
        </div>
        <div className={styles.buttons}>
          <Button
            icon={<HeartIcon size={16} />}
            disabled={recording.loading}
            onClick={() => record()}
          >
            Prayed <span className={styles.srOnly}>for {person.name}</span>
          </Button>
          <Button
            variant="secondary"
            aria-expanded={backOpen}
            onClick={() => {
              recording.reset()
              setBackOpen((open) => !open)
            }}
          >
            Another day
          </Button>
        </div>
      </div>

      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}

      {/* Always mounted, so screen readers announce each message as it's swapped in. */}
      <div role="status" className={logged ? styles.logged : styles.srOnly}>
        {logged && (
          <>
            <span>{logged.text}</span>
            <Button variant="secondary" disabled={undoing.loading} onClick={undo}>
              Undo
            </Button>
          </>
        )}
      </div>

      {backOpen && (
        <AnotherDayForm
          busy={recording.loading}
          onCancel={() => setBackOpen(false)}
          onSave={async (date) => {
            // Today isn't back-dated: record it as now.
            const now = new Date()
            const saved = await record(
              date === todayIsoDate(now) ? undefined : contactDateToTimestamp(date, now),
            )
            if (saved) setBackOpen(false)
          }}
        />
      )}

      {person.prayers.length > 0 && <PrayerHistory prayers={person.prayers} meId={meId} />}
    </div>
  )
}

function AnotherDayForm({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean
  onCancel: () => void
  onSave: (date: string) => void
}) {
  const fieldId = useId()
  // The date the form opened on; the check on save uses the time then.
  const [today] = useState(() => todayIsoDate())
  const [date, setDate] = useState(today)
  const [error, setError] = useState<string>()

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = !date
      ? 'Choose the day you prayed.'
      : date > todayIsoDate()
        ? 'The date can’t be in the future.'
        : undefined
    setError(found)
    if (found) {
      document.getElementById(fieldId)?.focus()
      return
    }
    onSave(date)
  }

  return (
    <form
      noValidate
      className={styles.form}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <DateField
        id={fieldId}
        label="Day you prayed"
        required
        value={date}
        max={today}
        error={error}
        help="For a prayer you forgot to log. It shows in the history as back-dated. It can’t be in the future."
        className={styles.date}
        onChange={(e) => {
          setDate(e.target.value)
          setError(undefined)
        }}
      />
      <div className={styles.formActions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save prayer'}
        </Button>
      </div>
    </form>
  )
}

function PrayerHistory({ prayers, meId }: { prayers: Prayer[]; meId: string | undefined }) {
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)
  const sorted = [...prayers].sort(byPrayedDay)
  const earlier = sorted.length - SHOWN

  return (
    <div className={styles.history}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide' : 'Show'} prayer history ({sorted.length})
      </button>
      {open && (
        <>
          <ul aria-label="Prayer history" className={styles.list}>
            {(all ? sorted : sorted.slice(0, SHOWN)).map((p) => {
              const backDated = isBackDated(p)
              const who = prayerAuthor(p, meId)
              return (
                <li key={p.id} className={styles.item}>
                  <span aria-hidden="true" className={styles.initials}>
                    {p.prayedBy ? initials(p.prayedBy.name) : '?'}
                  </span>
                  <div className={styles.itemText}>
                    <p className={styles.when}>
                      <time dateTime={p.prayedAt}>{formatShortDate(p.prayedAt)}</time>{' '}
                      <span className={styles.ago}>· {calendarAgo(p.prayedAt)}</span>
                      {backDated && <span className={styles.pill}>Back-dated</span>}
                    </p>
                    <p className={styles.meta}>
                      {backDated ? `${who} · logged ${calendarAgo(p.createdAt)}` : who}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
          {earlier > 0 && (
            <button type="button" className={styles.toggle} onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `Show ${earlier} earlier`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
