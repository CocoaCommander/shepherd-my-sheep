import { useMemo, type ReactNode } from 'react'
import { STATUS_LABELS, type PersonStatus } from '../components'
import { friendlyMessage } from '../errors'
import { firstName } from '../format'
import {
  ContactState,
  useStatusesQuery,
  useUndoStatusChangeMutation,
  useUpdatePersonMutation,
  type PersonSummaryFragment,
  type UpdatePersonMutation,
} from '../generated/graphql'
import { RELOAD_CONTACT_LISTS } from './contactToast'
import { isTracked, movedMessage, statusOf } from './peopleBoard'
import { STATUS_BY_NAME } from './personStatus'

type Summary = UpdatePersonMutation['updatePerson']

/**
 * Moving a person to another status, shared by My people and the Person page. A new contact
 * becomes active only by logging their follow-up (business rule 6), so that move calls
 * `onLogContact` instead; every other move saves at once and toasts with Undo.
 */
export function useStatusMove<P extends PersonSummaryFragment>({
  show,
  narrow,
  onLogContact,
}: {
  /** The page's toast. */
  show: (message: ReactNode, onUndo?: () => void) => void
  narrow: boolean
  onLogContact: (person: P) => void
}) {
  const { data: statusData } = useStatusesQuery()
  const [updatePerson] = useUpdatePersonMutation()
  const [undoStatusChange] = useUndoStatusChangeMutation()

  const statusIds = useMemo(() => {
    const ids = new Map<PersonStatus, { id: string; name: string }>()
    for (const s of statusData?.statuses ?? []) {
      const status = STATUS_BY_NAME[s.name]
      if (status) ids.set(status, s)
    }
    return ids
  }, [statusData])

  function undo(saved: Summary) {
    const first = firstName(saved.name)
    if (!saved.statusChangedAt) return undefined
    const variables = {
      personId: saved.id,
      statusId: saved.status.id,
      statusChangedAt: saved.statusChangedAt,
    }
    return () => {
      undoStatusChange({ variables, ...RELOAD_CONTACT_LISTS }).then(
        ({ data: undone }) => {
          const back = undone && statusOf(undone.undoStatusChange)
          show(back ? `${first} is back in ${STATUS_LABELS[back]}.` : `Moved ${first} back.`)
        },
        (e) => show(`Couldn't undo. ${friendlyMessage(e)}`),
      )
    }
  }

  /**
   * Moves `person` to `to`. True when a save was sent, so the caller can follow the move;
   * `onFailed` runs if that save fails.
   */
  function move(person: P, to: PersonStatus, onFailed?: () => void): boolean {
    const from = statusOf(person)
    if (from === to) return false
    if (from === 'new' && to === 'active') {
      onLogContact(person)
      return false
    }
    const status = statusIds.get(to)
    if (!status) return false
    updatePerson({
      variables: { id: person.id, input: { statusId: status.id } },
      // The person moves at once; Apollo drops this layer if the mutation fails, so they move
      // back. Any move restarts or stops the clock, so the due time waits for the server.
      optimisticResponse: {
        updatePerson: {
          // Other fields (createdAt) ride along; Apollo writes only those the mutation selects.
          ...person,
          __typename: 'Person',
          status: { __typename: 'Status', ...status },
          contactState: isTracked(to) ? ContactState.OnTrack : ContactState.NotTracked,
          contactDueAt: null,
          contactClockStart: null,
        },
      },
      // The bell's count: a move can take someone out of the alerts or put them back.
      ...RELOAD_CONTACT_LISTS,
    }).then(
      ({ data: moved }) => {
        // Undo names the move by the server's statusChangedAt, so it waits for the response.
        if (moved) show(movedMessage(person.name, to, narrow), undo(moved.updatePerson))
      },
      (e) => {
        onFailed?.()
        show(`Couldn't move ${firstName(person.name)}. ${friendlyMessage(e)}`)
      },
    )
    return true
  }

  return { move, canMove: statusIds.size > 0 }
}
