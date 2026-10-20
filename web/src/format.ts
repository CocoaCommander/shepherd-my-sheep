// The API sends Postgres text: DateTime as "2026-10-14 18:26:10.89+00"
// and Date as "2026-10-14". Neither is reliably parsed by `new Date`.

/** "2026-10-14 18:26:10.89+00" → a Date. */
export function parseDateTime(value: string): Date {
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  return new Date(iso)
}

export function formatDateTime(value: string): string {
  return parseDateTime(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** "2026-10-14" → a local date, without the UTC shift `new Date()` applies. */
export function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Today in the user's time zone as "YYYY-MM-DD", the API's Date format. */
export function todayIsoDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** "2026-10-14 18:26:10.89+00" → "Wed, Oct 14" in the user's locale and time zone. */
export function formatShortDate(value: string): string {
  return parseDateTime(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * A contact date from a date input ("YYYY-MM-DD") → the ISO time to log. Today sends the
 * current time; an earlier day sends 12:00 local that day, since the time isn't known.
 */
export function contactDateToTimestamp(date: string, now: Date = new Date()): string {
  if (date === todayIsoDate(now)) return now.toISOString()
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12).toISOString()
}

/** "Maria Santos" → "Maria". A single name is returned whole. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]
}

/** True if the DateTime falls on today's date in the user's time zone. */
export function isToday(value: string, now: Date = new Date()): boolean {
  return todayIsoDate(parseDateTime(value)) === todayIsoDate(now)
}

/** "3 days", "1 day", "5 hours", "under an hour" — for contact due times. */
export function humanSpan(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return 'under an hour'
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * Badge text for a contact state (business rule 6): "Overdue · 2 days",
 * "Due in 5 hours", "On track". Null when the person isn't tracked.
 */
export function contactStateLabel(
  state: string,
  dueAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (state === 'NOT_TRACKED' || !dueAt) return null
  const diff = parseDateTime(dueAt).getTime() - now.getTime()
  switch (state) {
    case 'OVERDUE':
      return `Overdue · ${humanSpan(-diff)}`
    case 'DUE_SOON':
      return `Due in ${humanSpan(diff)}`
    default:
      return 'On track'
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** "under an hour", "1 hour", "5 hours"; rounds down, so it never promises time that isn't left. */
function hoursText(ms: number): string {
  const hours = Math.floor(ms / HOUR)
  if (hours < 1) return 'under an hour'
  return hours === 1 ? '1 hour' : `${hours} hours`
}

const daysText = (days: number) => (days === 1 ? '1 day' : `${days} days`)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Whole calendar days from `now`'s date to `due`'s date, in the user's time zone. */
function calendarDaysUntil(due: Date, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  // Rounded, since a DST change makes a day 23 or 25 hours.
  return Math.round((end.getTime() - start.getTime()) / DAY)
}

export interface ContactDue {
  /** Matches DueTag's tones. */
  tone: 'overdue' | 'soon' | 'ok'
  /** "Follow-up overdue", "5 hours left", "3 days overdue", "Due today", "On track". */
  title: string
  /** "Next contact due in 5 days"; only when on track. */
  detail?: string
}

/**
 * The Person page's contact banner text (business rule 6). The state and due time come from the
 * server's person_contact_state, so no window is computed here; null when they aren't tracked.
 */
export function contactDueLabel(
  person: { status: { name: string }; contactState: string; contactDueAt?: string | null },
  now: Date = new Date(),
): ContactDue | null {
  const { contactState: state, contactDueAt } = person
  if (state === 'NOT_TRACKED' || !contactDueAt) return null
  const due = parseDateTime(contactDueAt)

  // A new contact has hours, not days, to be followed up.
  if (person.status.name === 'new contact') {
    const left = hoursText(due.getTime() - now.getTime())
    switch (state) {
      case 'OVERDUE':
        return { tone: 'overdue', title: 'Follow-up overdue' }
      case 'DUE_SOON':
        return { tone: 'soon', title: `${capitalize(left)} left` }
      default:
        return {
          tone: 'ok',
          title: 'On track',
          detail: `${capitalize(left)} left to log a contact`,
        }
    }
  }

  const days = calendarDaysUntil(due, now)
  switch (state) {
    case 'OVERDUE':
      return { tone: 'overdue', title: days < 0 ? `${daysText(-days)} overdue` : 'Overdue today' }
    case 'DUE_SOON':
      return { tone: 'soon', title: days <= 0 ? 'Due today' : `Due in ${daysText(days)}` }
    default:
      return { tone: 'ok', title: 'On track', detail: `Next contact due in ${daysText(days)}` }
  }
}
