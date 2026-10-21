import {
  MILESTONES,
  STATUS_LABELS,
  type DueTone,
  type PersonStatus,
  type ViewMode,
} from '../components'
import { contactDueLabel, parseDateTime } from '../format'
import { ContactState, type MyPeopleQuery } from '../generated/graphql'
import { STATUS_BY_NAME } from './personStatus'

export type Person = MyPeopleQuery['myPeople'][number]

/** The board's columns, left to right, and the mobile tabs. */
export const STATUS_ORDER: readonly PersonStatus[] = ['new', 'active', 'inactive', 'lost']

/** The cadence under each column title (business rule 6). */
export const STATUS_RULES: Record<PersonStatus, string> = {
  new: 'Follow up within 72 hours',
  active: 'Contact at least every 7 days',
  inactive: 'Not tracked for alerts',
  lost: 'Not tracked for alerts',
}

/** Inactive and lost contact people aren't held to a cadence (business rule 6). */
export const isTracked = (status: PersonStatus) => status === 'new' || status === 'active'

export const statusOf = (person: Pick<Person, 'status'>): PersonStatus =>
  STATUS_BY_NAME[person.status.name] ?? 'active'

/** The API's milestone names → the milestone bar's (MILESTONES). */
const MILESTONE_LABELS: Record<string, (typeof MILESTONES)[number]> = {
  baptised: 'Baptised',
  'joined small group': 'Small group',
  serving: 'Serving',
  leading: 'Leading',
}

/**
 * The bar's names for a person's recorded milestones. `names` maps milestone id → API name
 * (the Milestones query); until it loads the bar is empty. A person may have none (rule 2).
 */
export function milestoneLabels(ids: readonly string[], names: ReadonlyMap<string, string>) {
  return ids.flatMap((id) => {
    const label = MILESTONE_LABELS[names.get(id) ?? '']
    return label ? [label] : []
  })
}

/**
 * A column's order: tracked people by when contact is due, soonest (most overdue) first, as
 * contactAlerts sorts them; untracked people, and ties, by name.
 */
export function byUrgency(a: Person, b: Person): number {
  const due = (p: Person) =>
    p.contactDueAt ? parseDateTime(p.contactDueAt).getTime() : Number.POSITIVE_INFINITY
  // NaN when neither has a due time.
  const diff = due(a) - due(b)
  return diff !== 0 && !Number.isNaN(diff) ? diff : a.name.localeCompare(b.name)
}

/**
 * The card's contact tag: "3 days overdue", "Follow-up overdue", "Due today", "5 hours left",
 * "On track" or "Not tracked". The state and due time are the server's.
 */
export function contactTag(
  person: Pick<Person, 'status' | 'contactState' | 'contactDueAt'>,
  now: Date = new Date(),
): { tone: DueTone; label: string } {
  if (person.contactState === ContactState.NotTracked) return { tone: 'none', label: 'Not tracked' }
  const due = contactDueLabel(person, now)
  // No due time yet: the optimistic frame of a move, before the server sets one.
  return due ? { tone: due.tone, label: due.title } : { tone: 'ok', label: 'On track' }
}

/**
 * "Moved Elena Petrova to Inactive. No longer tracked for contact alerts." The mobile toast is
 * narrower, so it drops "contact".
 */
export function movedMessage(name: string, to: PersonStatus, narrow: boolean): string {
  const moved = `Moved ${name} to ${STATUS_LABELS[to]}.`
  if (isTracked(to)) return moved
  return `${moved} No longer tracked for ${narrow ? 'alerts' : 'contact alerts'}.`
}

const VIEW_KEY = 'shepherd.people.view'

/**
 * The view last chosen on this device (decided 2026-10-16). Board unless Gallery was stored;
 * storage can be blocked or throw (private windows), which also means Board.
 */
export function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'gallery' ? 'gallery' : 'board'
  } catch {
    return 'board'
  }
}

export function storeView(view: ViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Ignored, see readView: the choice just isn't remembered.
  }
}

/** The gallery's order: by name, as the canvas sorts it. */
export const byName = (a: Person, b: Person) =>
  a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Case-insensitive substring search by name; a blank query matches everyone. */
export function matchesName(person: Pick<Person, 'name'>, query: string): boolean {
  const q = query.trim().toLocaleLowerCase()
  return !q || person.name.toLocaleLowerCase().includes(q)
}

/** "52 years old · Met 2016", "Met 2016", "52 years old", or nothing when neither is known. */
export function personSubtitle(person: Pick<Person, 'age' | 'yearMet'>): string | undefined {
  const parts = []
  if (person.age != null) parts.push(`${person.age} years old`)
  if (person.yearMet != null) parts.push(`Met ${person.yearMet}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** "1 person you are shepherding", "9 people you are shepherding". */
export function shepherdingCount(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'} you are shepherding`
}
