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
