import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'
import { formatDateTime } from '../format'
import {
  ContactAlertsDocument,
  MyPeopleDocument,
  useDeletePersonMutation,
  useStatusesQuery,
  useUnassignPersonMutation,
  useUpdatePersonMutation,
  type PersonQuery,
  type UpdatePersonInput,
} from '../generated/graphql'
import { ActionButton } from './ActionButton'
import { AddShepherd } from './AddShepherd'
import { ErrorMessage } from './ErrorMessage'
import styles from './PersonSidebar.module.css'

type Person = NonNullable<PersonQuery['person']>

/** The contact rule for the person's status, in words (business rule 6). */
function contactRule(status: string): string {
  switch (status) {
    case 'new contact':
      return 'A new contact needs a follow-up within 72 hours of being added.'
    case 'active':
      return 'Active people need a contact at least every 7 days.'
    default:
      return 'Contact reminders are off while they are inactive or lost contact.'
  }
}

/**
 * The Person page's sidebar (web) or lower sections (phones): facts, the contact rule,
 * shepherds and Delete. Phones show them in a different order, set by the stylesheet.
 */
export function PersonSidebar({ person, meId }: { person: Person; meId: string | undefined }) {
  const isNewContact = person.status.name === 'new contact'

  return (
    <aside className={styles.sidebar} aria-label="About">
      <section className={`card stack ${styles.details}`}>
        <h2>Details</h2>
        <dl className="facts">
          <Fact label="Age" value={person.age} empty="Not recorded" />
          <Fact label="Year met" value={person.yearMet} />
          {isNewContact && <Fact label="Added" value={formatDateTime(person.createdAt)} />}
          <Fact
            label="Last contact"
            value={person.lastContactedAt && formatDateTime(person.lastContactedAt)}
            empty="None yet"
          />
          <Fact label="Active" value={person.isActive ? 'Yes' : 'No'} />
        </dl>
      </section>
      <section className={`card stack ${styles.shepherds}`}>
        <Shepherds person={person} meId={meId} />
      </section>
      <section className={`card stack ${styles.rule}`}>
        <h2>Contact rule</h2>
        <p className="muted small">{contactRule(person.status.name)}</p>
      </section>
      <div className={styles.delete}>
        <DeletePersonButton person={person} />
      </div>
    </aside>
  )
}

function Fact({
  label,
  value,
  empty = '—',
}: {
  label: string
  value: string | number | null | undefined
  /** Shown, muted, when there is no value. */
  empty?: string
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value === null || value === undefined || value === '' ? (
          <span className="muted">{empty}</span>
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
    navigate('/people')
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
      <h2>Shepherds</h2>
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

const toText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value)
const toNumber = (value: string) => (value === '' ? null : Number(value))

export function EditPersonForm({ person, onDone }: { person: Person; onDone: () => void }) {
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
