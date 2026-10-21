import { Button, CheckIcon, ClockIcon, Meter, WarningIcon, type MeterTone } from '../components'
import { contactDueLabel, isToday, type ContactDue } from '../format'
import type { ContactState } from '../generated/graphql'
import styles from './ContactPanel.module.css'
import { contactWindow, contactWindowLabel, type ContactWindow } from './contactWindow'

type PanelPerson = {
  status: { name: string }
  contactState: ContactState
  contactDueAt?: string | null
  contactClockStart?: string | null
  lastContactedAt?: string | null
  createdAt: string
}

const TONES: Record<ContactDue['tone'], MeterTone> = { overdue: 'danger', soon: 'warn', ok: 'ok' }
const ICONS = { overdue: WarningIcon, soon: ClockIcon, ok: CheckIcon }

/** The bar never looks empty while on track, and is full once overdue. */
const MIN_FILL = 0.04

/**
 * The sub line: what started the clock, then how long is left (on track) or the goal.
 * "2 days since last contact. Next contact due in 5 days."
 */
function subLine(person: PanelPerson, clock: ContactWindow, due: ContactDue, now: Date): string {
  const isNew = person.status.name === 'new contact'
  let lead: string
  if (clock.kind === 'contact' && person.lastContactedAt && isToday(person.lastContactedAt, now)) {
    lead = 'Contacted today'
  } else if (clock.kind === 'added' && isNew) {
    // Any contact logged for a new contact makes them active, so "no contact logged" goes
    // without saying.
    lead = `Added ${clock.span} ago`
  } else {
    lead = contactWindowLabel(clock, isNew)
  }

  const tail =
    due.tone === 'ok' && due.detail
      ? `${due.detail}.`
      : isNew
        ? 'Follow up within 72 hours.'
        : 'Goal is every 7 days.'
  return `${lead}. ${tail}`
}

/**
 * Where the person stands against the contact rule (business rule 6): headline, sub line and
 * a bar over their contact window, with the Log contact button. The tone always comes with an
 * icon and words, never colour alone. People who aren't tracked get the button alone.
 */
export function ContactPanel({
  person,
  now = new Date(),
  onLogContact,
}: {
  person: PanelPerson
  now?: Date
  onLogContact: () => void
}) {
  const due = contactDueLabel(person, now)
  const clock = contactWindow(person, now)

  if (!due || !clock) {
    return (
      <div className={styles.untracked}>
        <Button variant="secondary" onClick={onLogContact}>
          Log contact
        </Button>
      </div>
    )
  }

  const Icon = ICONS[due.tone]
  const sub = subLine(person, clock, due, now)
  let value = clock.value
  if (due.tone === 'overdue') value = clock.max
  else if (due.tone === 'ok') value = Math.max(clock.value, clock.max * MIN_FILL)

  return (
    // Overdue is announced, as the Alert banner this replaces was.
    <div
      className={`${styles.panel} ${styles[due.tone]}`}
      role={due.tone === 'overdue' ? 'alert' : undefined}
    >
      <div className={styles.text}>
        <p className={styles.headline}>
          <Icon size={18} aria-hidden="true" />
          {due.title}
        </p>
        {/* The sub line is the Meter's label, which also names the bar. */}
        <Meter
          className={styles.meter}
          value={value}
          max={clock.max}
          tone={TONES[due.tone]}
          label={sub}
        />
      </div>
      <Button variant={due.tone === 'overdue' ? 'danger' : 'primary'} onClick={onLogContact}>
        Log contact
      </Button>
    </div>
  )
}
