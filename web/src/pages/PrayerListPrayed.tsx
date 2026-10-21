import { useEffect, useRef, useState } from 'react'
import { Button, HeartIcon, TOAST_MS } from '../components'
import { calendarAgo, firstName } from '../format'
import {
  useDeletePrayerMutation,
  useRecordPrayerMutation,
  type PersonSummaryFragment,
} from '../generated/graphql'
import { prayerAuthor } from './PersonPrayed'
import styles from './PrayerListPage.module.css'

type LastPrayer = PersonSummaryFragment['lastPrayer']
type Person = { id: string; name: string }

/** The prayer just recorded from the list, while its Undo shows. */
type Prayed = { personId: string; prayerId: string }

/**
 * Before the Undo buttons go, move focus from the one in use to its row's Prayed button, so
 * keyboard and screen reader users aren't dropped to the top of the page.
 */
function keepFocusInRow() {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.hasAttribute('data-prayer-undo')) return
  active.closest('article')?.querySelector<HTMLElement>('[data-prayed]')?.focus()
}

/**
 * Prayed on the Prayer list: records a prayer for the person now (no back-dating here; that's
 * Another day on the Person page), and keeps its Undo up on every row of that person. The
 * results carry PersonSummary, so `myPeople` (and so every row's line) updates with no refetch.
 * `statusElement` is the one live region for all rows: a region per row would announce once
 * for each burden the person has. Render it once, unconditionally.
 */
export function usePrayed() {
  const [prayed, setPrayed] = useState<Prayed | null>(null)
  const [announced, setAnnounced] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [recordPrayer, recording] = useRecordPrayerMutation()
  const [deletePrayer, undoing] = useDeletePrayerMutation()

  useEffect(() => () => clearTimeout(timer.current), [])

  const clear = () => {
    clearTimeout(timer.current)
    keepFocusInRow()
    setPrayed(null)
    setAnnounced('')
  }

  async function pray(person: Person) {
    if (recording.loading) return
    undoing.reset()
    try {
      const result = await recordPrayer({ variables: { personId: person.id } })
      // Recorded now, so it's the latest (only an API caller can back-date into the next minutes).
      const prayerId = result.data?.recordPrayer.lastPrayer?.id
      if (!prayerId) return
      clearTimeout(timer.current)
      setPrayed({ personId: person.id, prayerId })
      setAnnounced(`Prayed for ${firstName(person.name)} today.`)
      timer.current = setTimeout(clear, TOAST_MS)
    } catch {
      // Shown from `error`.
    }
  }

  async function undo() {
    if (!prayed || undoing.loading) return
    try {
      await deletePrayer({ variables: { id: prayed.prayerId } })
      clear()
    } catch {
      // Shown from `error`; Undo stays so it can be retried.
    }
  }

  const statusElement = (
    <div role="status" className={styles.srOnly}>
      {announced}
    </div>
  )

  return {
    pray,
    undo,
    /** Whether `personId`'s rows show "Prayed for … today." with Undo. */
    justPrayed: (personId: string) => prayed?.personId === personId,
    recording: recording.loading,
    undoing: undoing.loading,
    error: recording.error ?? undoing.error,
    statusElement,
  }
}

/** "Last prayed for Maria 3 days ago by Grace Lin", under a burden; shown under Hide details too. */
export function PrayedLine({
  person,
  lastPrayer,
  meId,
  now,
  justPrayed,
  undoing,
  onUndo,
}: {
  person: Person
  lastPrayer: LastPrayer
  meId?: string
  now: Date
  justPrayed: boolean
  undoing: boolean
  onUndo: () => void
}) {
  const first = firstName(person.name)
  return (
    <p className={styles.prayed}>
      <HeartIcon className={styles.prayedIcon} />
      <span>
        {justPrayed
          ? `Prayed for ${first} today.`
          : lastPrayer
            ? `Last prayed for ${first} ${calendarAgo(lastPrayer.prayedAt, now)} by ${prayerAuthor(lastPrayer, meId, { lower: true })}`
            : // A person may have no prayer records.
              'Not prayed for yet.'}
      </span>
      {justPrayed && (
        <Button
          variant="text"
          className={styles.prayedUndo}
          data-prayer-undo=""
          disabled={undoing}
          onClick={onUndo}
        >
          Undo <span className={styles.srOnly}>prayer for {person.name}</span>
        </Button>
      )}
    </p>
  )
}
