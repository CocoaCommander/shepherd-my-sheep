import { useCallback } from 'react'
import { useUndoToast } from '../components'
import { friendlyMessage } from '../errors'
import { firstName, formatShortDate, parseDateTime } from '../format'
import {
  ContactAlertsDocument,
  MyPeopleDocument,
  useDeleteContactMutation,
  type LogContactMutation,
} from '../generated/graphql'

/** The person as LogContact returns them. */
export type LoggedPerson = LogContactMutation['logContact']

// Logging or undoing a contact can move the person in or out of the alert list,
// and changes their status, so both lists reload.
export const RELOAD_CONTACT_LISTS = {
  refetchQueries: [{ query: MyPeopleDocument }, { query: ContactAlertsDocument }],
}

/**
 * The id of the contact just logged. contacts are ordered by contactedAt, so a back-dated
 * contact may not be first; the newest by createdAt is the one just saved.
 */
export function loggedContactId(person: Pick<LoggedPerson, 'contacts'>): string | undefined {
  let newest: LoggedPerson['contacts'][number] | undefined
  for (const c of person.contacts) {
    if (!newest || parseDateTime(c.createdAt) > parseDateTime(newest.createdAt)) newest = c
  }
  return newest?.id
}

/**
 * "Contact logged with Maria. Maria is now Active. Next contact due Wed, Oct 21." The due date
 * is the server's (business rule 6); it's left out when the person isn't tracked.
 */
export function contactLoggedMessage(person: LoggedPerson, wasNewContact: boolean): string {
  const first = firstName(person.name)
  const parts = [`Contact logged with ${first}.`]
  if (wasNewContact && person.status.name === 'active') parts.push(`${first} is now Active.`)
  if (person.contactDueAt) parts.push(`Next contact due ${formatShortDate(person.contactDueAt)}.`)
  return parts.join(' ')
}

/**
 * The confirmation toast after logging a contact. Undo deletes the contact, which also removes
 * its note and burden, and moves a follow-up back to new contact on the server. `show` is the
 * same toast, for a page's other messages, so two toasts never stack.
 */
export function useLogContactToast(options?: Parameters<typeof useUndoToast>[0]) {
  const { show, hide, toastElement } = useUndoToast(options)
  const [deleteContact] = useDeleteContactMutation(RELOAD_CONTACT_LISTS)

  const showLogged = useCallback(
    (person: LoggedPerson, wasNewContact: boolean) => {
      const id = loggedContactId(person)
      const undo = id
        ? () => {
            deleteContact({ variables: { id } }).then(
              () => show(`Contact with ${firstName(person.name)} removed.`),
              (e) => show(`Couldn't undo. ${friendlyMessage(e)}`),
            )
          }
        : undefined
      show(contactLoggedMessage(person, wasNewContact), undo)
    },
    [deleteContact, show],
  )

  return { show, showLogged, hide, toastElement }
}
