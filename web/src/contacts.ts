import type { LogContactInput } from './generated/graphql'

/**
 * The API needs a note with every contact. Until the one-tap buttons open
 * the "Log contact" modal, they log this instead.
 */
export const QUICK_CONTACT_NOTE = 'Contacted (no note added).'

/** A contact made now, as the one-tap buttons log it. */
export function quickContact(personId: string): LogContactInput {
  return { personId, contactedAt: new Date().toISOString(), note: QUICK_CONTACT_NOTE }
}
