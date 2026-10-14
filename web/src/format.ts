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
