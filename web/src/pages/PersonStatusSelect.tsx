import { Select, STATUS_LABELS, type PersonStatus } from '../components'
import type { PersonSummaryFragment } from '../generated/graphql'
import { statusOf } from './peopleBoard'

/** The canvas's order, which starts from the status most people are in. */
const OPTIONS: readonly PersonStatus[] = ['active', 'new', 'inactive', 'lost']

/**
 * The Person page's status dropdown. It always shows the saved status: a move updates the
 * cached person (at once, optimistically), and a move that doesn't happen, such as New
 * contact → Active waiting on Log contact, leaves the dropdown where it was.
 */
export function PersonStatusSelect({
  person,
  disabled,
  onMove,
  label,
  className,
}: {
  person: Pick<PersonSummaryFragment, 'status'>
  disabled: boolean
  onMove: (to: PersonStatus) => void
  /** A visible label (phones' Details section); the header's has none. */
  label?: string
  className?: string
}) {
  const current = statusOf(person)

  return (
    <Select
      aria-label="Change status"
      label={label}
      value={current}
      disabled={disabled}
      className={className}
      onChange={(e) => onMove(e.target.value as PersonStatus)}
    >
      {OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s === current ? `Status: ${STATUS_LABELS[s]}` : STATUS_LABELS[s]}
        </option>
      ))}
    </Select>
  )
}
