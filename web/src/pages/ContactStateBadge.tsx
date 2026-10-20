import { contactStateLabel } from '../format'
import { ContactState } from '../generated/graphql'

const badgeClass: Record<ContactState, string> = {
  [ContactState.Overdue]: 'badge badge-overdue',
  [ContactState.DueSoon]: 'badge badge-due',
  [ContactState.OnTrack]: 'badge',
  [ContactState.NotTracked]: 'badge',
}

/**
 * How the person stands against the contact rule. Renders nothing when they aren't tracked.
 * For an overdue new contact, what's missed is the follow-up (business rule 6).
 */
export function ContactStateBadge({
  person,
}: {
  person: { contactState: ContactState; contactDueAt?: string | null; status: { name: string } }
}) {
  const label =
    person.contactState === ContactState.Overdue && person.status.name === 'new contact'
      ? 'Follow-up overdue'
      : contactStateLabel(person.contactState, person.contactDueAt)
  if (!label) return null
  return <span className={badgeClass[person.contactState]}>{label}</span>
}
