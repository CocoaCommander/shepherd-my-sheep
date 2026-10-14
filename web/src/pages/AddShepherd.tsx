import { useEffect, useState } from 'react'
import { useAssignPersonMutation, useSearchUsersQuery } from '../generated/graphql'
import { ErrorMessage } from './ErrorMessage'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 250

/** Waits until `value` has stopped changing for `delay` ms. */
function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Finds another user by name or username and adds them as a shepherd. */
export function AddShepherd({
  personId,
  shepherdIds,
}: {
  personId: string
  shepherdIds: string[]
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Add shepherd
      </button>
    )
  }
  return (
    <ShepherdSearch personId={personId} shepherdIds={shepherdIds} onDone={() => setOpen(false)} />
  )
}

function ShepherdSearch({
  personId,
  shepherdIds,
  onDone,
}: {
  personId: string
  shepherdIds: string[]
  onDone: () => void
}) {
  const [text, setText] = useState('')
  const query = useDebounced(text.trim(), DEBOUNCE_MS)
  const searching = query.length >= MIN_QUERY_LENGTH

  const { data, error } = useSearchUsersQuery({ variables: { query }, skip: !searching })
  // The result's shepherds list is merged into the cached person.
  const [assignPerson, assignState] = useAssignPersonMutation()

  // The API leaves out the caller; existing shepherds are left out here.
  const results = (data?.searchUsers ?? []).filter((u) => !shepherdIds.includes(u.id))

  async function add(userId: string) {
    try {
      await assignPerson({ variables: { personId, userId } })
      onDone()
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <div className="stack subform compact">
      <label>
        Search users
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name or username"
          maxLength={100}
          autoFocus
        />
      </label>

      {searching && data && results.length === 0 && <p className="empty">No users found.</p>}
      {searching && results.length > 0 && (
        <ul className="list">
          {results.map((u) => (
            <li key={u.id} className="item-head">
              <span>
                {u.name} <span className="muted small">@{u.username}</span>
              </span>
              <button
                type="button"
                className="link"
                aria-label={`Add ${u.name} as shepherd`}
                disabled={assignState.loading}
                onClick={() => add(u.id)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}

      <ErrorMessage error={error} />
      <ErrorMessage error={assignState.error} />
      <button type="button" className="link" onClick={onDone}>
        Done
      </button>
    </div>
  )
}
