import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'
import { formatDateTime, isToday } from '../format'
import {
  ContactAlertsDocument,
  MyPeopleDocument,
  useDeleteContactMutation,
  useDeletePersonMutation,
  useLogContactMutation,
  useStatusesQuery,
  useUnassignPersonMutation,
  useUpdatePersonMutation,
  type PersonQuery,
  type UpdatePersonInput,
} from '../generated/graphql'
import { ActionButton } from './ActionButton'
import { AddShepherd } from './AddShepherd'
import { ContactStateBadge } from './ContactStateBadge'
import { ErrorMessage } from './ErrorMessage'

type Person = NonNullable<PersonQuery['person']>

/** The person's facts, with an inline form to edit them. */
export function PersonDetailsCard({ person, meId }: { person: Person; meId: string | undefined }) {
  const [editing, setEditing] = useState(false)

  return (
    <section className="card stack">
      <div className="title-row">
        <h1>{person.name}</h1>
        <span className="badges">
          <ContactStateBadge person={person} />
          <span className={`badge${person.isActive ? '' : ' badge-muted'}`}>
            {person.status.name}
          </span>
        </span>
      </div>

      {editing ? (
        // Mounted fresh each time, so it always starts from the saved values.
        <EditPersonForm person={person} onDone={() => setEditing(false)} />
      ) : (
        <>
          <dl className="facts">
            <Fact label="Age" value={person.age} />
            <Fact label="Year met" value={person.yearMet} />
            <Fact
              label="Last contact"
              value={person.lastContactedAt && formatDateTime(person.lastContactedAt)}
            />
            <Fact label="Active" value={person.isActive ? 'Yes' : 'No'} />
          </dl>
          <Shepherds person={person} meId={meId} />
          <div className="card-actions">
            <LogContactButtons person={person} />
            <button type="button" className="link" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <DeletePersonButton person={person} />
          </div>
        </>
      )}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value === null || value === undefined || value === '' ? (
          <span className="muted">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

// The alert list depends on status and contacts, so it reloads with My people.
const reloadMyPeople = {
  refetchQueries: [{ query: MyPeopleDocument }, { query: ContactAlertsDocument }],
}

/**
 * For leaving this page for good: the person is gone, or no longer ours.
 * Navigates first, then drops them from the cache, so this page doesn't
 * refetch them on the way out and Back doesn't show stale details.
 */
function useLeavePerson(personId: string) {
  const navigate = useNavigate()
  const client = useApolloClient()
  return () => {
    navigate('/')
    client.cache.evict({ id: client.cache.identify({ __typename: 'Person', id: personId }) })
    client.cache.gc()
  }
}

/**
 * Any shepherd may remove another, or step back themselves, but the API
 * refuses to remove the last one, so with a single shepherd there is nothing
 * to offer here; deleting the person is the way out.
 */
function Shepherds({ person, meId }: { person: Person; meId: string | undefined }) {
  const canRemove = person.shepherds.length > 1

  return (
    <div className="shepherds">
      <h3 className="facts-label">Shepherds</h3>
      <ul className="list">
        {person.shepherds.map((s) => (
          <li key={s.id} className="item-head">
            <span>
              {s.name}
              {s.id === meId && <span className="muted"> (you)</span>}
            </span>
            {canRemove &&
              (s.id === meId ? (
                <StopShepherdingButton person={person} meId={meId} />
              ) : (
                <RemoveShepherdButton personId={person.id} shepherd={s} />
              ))}
          </li>
        ))}
      </ul>
      <AddShepherd personId={person.id} shepherdIds={person.shepherds.map((s) => s.id)} />
    </div>
  )
}

function RemoveShepherdButton({
  personId,
  shepherd,
}: {
  personId: string
  shepherd: Person['shepherds'][number]
}) {
  // The result's shepherds list is merged into the cached person.
  const [unassignPerson, { loading, error }] = useUnassignPersonMutation()

  return (
    <ActionButton
      label="Remove"
      ariaLabel={`Remove ${shepherd.name} as shepherd`}
      question={`Remove ${shepherd.name} as a shepherd?`}
      confirmLabel="Yes, remove"
      loading={loading}
      error={error}
      onClick={() => unassignPerson({ variables: { personId, userId: shepherd.id } })}
    />
  )
}

function StopShepherdingButton({ person, meId }: { person: Person; meId: string }) {
  const leave = useLeavePerson(person.id)
  const [unassignPerson, { loading, error }] = useUnassignPersonMutation(reloadMyPeople)

  return (
    <ActionButton
      label="Stop shepherding"
      question={`Stop shepherding ${person.name}? They'll be removed from your list.`}
      confirmLabel="Yes, stop"
      loading={loading}
      error={error}
      onClick={async () => {
        await unassignPerson({ variables: { personId: person.id, userId: meId } })
        leave()
      }}
    />
  )
}

function DeletePersonButton({ person }: { person: Person }) {
  const leave = useLeavePerson(person.id)
  const [deletePerson, { loading, error }] = useDeletePersonMutation(reloadMyPeople)

  return (
    <ActionButton
      label="Delete person"
      danger
      question={`Delete ${person.name}? This removes them, their milestones, prayer burdens and notes for every shepherd. It can't be undone.`}
      confirmLabel="Yes, delete"
      loading={loading}
      error={error}
      onClick={async () => {
        await deletePerson({ variables: { id: person.id } })
        leave()
      }}
    />
  )
}

/**
 * Logs a contact now (business rule 6). A new contact also gets "Followed up
 * today", which moves them to active. A plain contact can be undone right
 * after; a follow-up can't, since undoing it wouldn't undo the status change.
 */
function LogContactButtons({ person }: { person: Person }) {
  const [logContact, logState] = useLogContactMutation(reloadMyPeople)
  const [deleteContact, undoState] = useDeleteContactMutation(reloadMyPeople)
  const [undoId, setUndoId] = useState<string | null>(null)

  async function log(isFollowUp: boolean) {
    try {
      const result = await logContact({
        variables: { input: { personId: person.id, isFollowUp } },
      })
      // contacts are newest first, so [0] is the one just logged.
      const logged = result.data?.logContact.contacts[0]?.id
      setUndoId(isFollowUp || !logged ? null : logged)
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  async function undo() {
    if (!undoId) return
    try {
      await deleteContact({ variables: { id: undoId } })
      setUndoId(null)
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  if (undoId) {
    return (
      <span className="action">
        <span className="muted">Contact logged.</span>{' '}
        <button type="button" className="link" disabled={undoState.loading} onClick={undo}>
          {undoState.loading ? 'Undoing…' : 'Undo'}
        </button>
        <ErrorMessage error={undoState.error} />
      </span>
    )
  }

  const isNewContact = person.status.name === 'new contact'
  if (!isNewContact && person.lastContactedAt && isToday(person.lastContactedAt)) return null

  return (
    <span className="action">
      <button type="button" className="link" disabled={logState.loading} onClick={() => log(false)}>
        {logState.loading ? 'Saving…' : 'Contacted today'}
      </button>
      {isNewContact && (
        <>
          {' · '}
          <button
            type="button"
            className="link"
            disabled={logState.loading}
            onClick={() => log(true)}
            title="Logs a follow-up and moves them to active"
          >
            Followed up today
          </button>
        </>
      )}
      <ErrorMessage error={logState.error} />
    </span>
  )
}

const toText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value)
const toNumber = (value: string) => (value === '' ? null : Number(value))

function EditPersonForm({ person, onDone }: { person: Person; onDone: () => void }) {
  const { data: statusData } = useStatusesQuery()
  // The result carries PersonSummary, which the cache merges into this person.
  const [updatePerson, { loading, error }] = useUpdatePersonMutation(reloadMyPeople)

  const [name, setName] = useState(person.name)
  const [statusId, setStatusId] = useState(person.status.id)
  const [age, setAge] = useState(toText(person.age))
  const [yearMet, setYearMet] = useState(toText(person.yearMet))
  const [isActive, setIsActive] = useState(person.isActive)

  /** Only what the user changed, so a concurrent edit by another shepherd isn't overwritten. */
  function changes(): UpdatePersonInput {
    const input: UpdatePersonInput = {}
    if (name.trim() !== person.name) input.name = name.trim()
    if (statusId !== person.status.id) input.statusId = statusId
    if (toNumber(age) !== person.age) input.age = toNumber(age)
    if (toNumber(yearMet) !== person.yearMet) input.yearMet = toNumber(yearMet)
    if (isActive !== person.isActive) input.isActive = isActive
    return input
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const input = changes()
    if (Object.keys(input).length === 0) {
      onDone()
      return
    }
    try {
      await updatePerson({ variables: { id: person.id, input } })
      onDone()
    } catch {
      // Shown from the mutation's `error` below; the form keeps the input.
    }
  }

  // The API treats null as "leave unchanged", so a value that is set can't be
  // cleared from here; `required` keeps the form from pretending otherwise.
  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      </label>
      <label>
        Status
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)} required>
          {(statusData?.statuses ?? [person.status]).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>
          <span>Age {person.age === null && <span className="muted">(optional)</span>}</span>
          <input
            type="number"
            min={0}
            max={150}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            required={person.age !== null}
          />
        </label>
        <label>
          <span>
            Year met {person.yearMet === null && <span className="muted">(optional)</span>}
          </span>
          <input
            type="number"
            min={1900}
            max={2100}
            value={yearMet}
            onChange={(e) => setYearMet(e.target.value)}
            required={person.yearMet !== null}
          />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>
      <ErrorMessage error={error} />
      <div className="card-actions">
        <button type="submit" disabled={loading || !name.trim()}>
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link" disabled={loading} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
