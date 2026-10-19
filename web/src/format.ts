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
