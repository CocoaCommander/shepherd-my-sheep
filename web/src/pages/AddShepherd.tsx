import { useEffect, useState } from 'react'
import { Alert, Button, SearchInput } from '../components'
import { friendlyMessage } from '../errors'
import { useAssignPersonMutation, useSearchUsersQuery } from '../generated/graphql'
import styles from './AddShepherd.module.css'

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
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add shepherd
      </Button>
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
    <div className={styles.search}>
      <SearchInput
        label="Search users"
        placeholder="Name or username"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={100}
        autoFocus
      />

      {searching && data && results.length === 0 && <p className={styles.empty}>No users found.</p>}
      {searching && results.length > 0 && (
        <ul className={styles.results}>
          {results.map((u) => (
            <li key={u.id} className={styles.result}>
              <span className={styles.who}>
                {u.name} <span className={styles.username}>@{u.username}</span>
              </span>
              <Button
                variant="text"
                aria-label={`Add ${u.name} as shepherd`}
                disabled={assignState.loading}
                onClick={() => add(u.id)}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      {assignState.error && <Alert variant="inline">{friendlyMessage(assignState.error)}</Alert>}
      <Button variant="secondary" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}
