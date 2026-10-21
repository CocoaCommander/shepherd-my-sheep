import { humanSpan, parseDateTime } from '../format'

/**
 * Where a tracked person is in their contact window (business rule 6). The server sets both
 * ends for every tracked person; the clock starts at the last contact, when they were added
 * if there's none, or when they were last moved to this status.
 */
export interface ContactWindow {
  /** Time used so far, in ms. */
  value: number
  /** The whole window, in ms. */
  max: number
  /** What started the clock. */
  kind: 'moved' | 'contact' | 'added'
  /** How long ago that was: "3 days", "5 hours". */
  span: string
}

type WindowPerson = {
  contactClockStart?: string | null
  contactDueAt?: string | null
  lastContactedAt?: string | null
  createdAt: string
}

/** The person's contact window, or null when they aren't tracked. */
export function contactWindow(person: WindowPerson, now: Date = new Date()): ContactWindow | null {
  if (!person.contactClockStart || !person.contactDueAt) return null
  const start = parseDateTime(person.contactClockStart).getTime()
  const due = parseDateTime(person.contactDueAt).getTime()
  const last = person.lastContactedAt ? parseDateTime(person.lastContactedAt).getTime() : null
  const added = parseDateTime(person.createdAt).getTime()
  const since = (time: number) => humanSpan(Math.max(now.getTime() - time, 0))

  const used = { value: now.getTime() - start, max: due - start }
  if (start > (last ?? added)) return { ...used, kind: 'moved', span: since(start) }
  if (last !== null) return { ...used, kind: 'contact', span: since(last) }
  return { ...used, kind: 'added', span: since(added) }
}

/** "Moved to Active 2 days ago", "3 days since last contact", "Added 5 hours ago, no contact logged". */
export function contactWindowLabel(clock: ContactWindow, isNewContact: boolean): string {
  switch (clock.kind) {
    case 'moved':
      return `Moved to ${isNewContact ? 'New contact' : 'Active'} ${clock.span} ago`
    case 'contact':
      return `${clock.span} since last contact`
    case 'added':
      return `Added ${clock.span} ago, no contact logged`
  }
}
