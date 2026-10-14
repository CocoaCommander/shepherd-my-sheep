import { useState, type FormEvent } from 'react'
import { formatDate, todayIsoDate } from '../format'
import {
  useStatusesQuery,
  useUpdatePersonMutation,
  type PersonQuery,
  type UpdatePersonInput,
} from '../generated/graphql'
import { ErrorMessage } from './ErrorMessage'

type Person = NonNullable<PersonQuery['person']>

/** The person's facts, with an inline form to edit them. */
export function PersonDetailsCard({ person }: { person: Person }) {
  const [editing, setEditing] = useState(false)

  return (
    <section className="card stack">
      <div className="title-row">
        <h1>{person.name}</h1>
        <span className={`badge${person.isActive ? '' : ' badge-muted'}`}>
          {person.status.name}
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
              value={person.lastContactDate && formatDate(person.lastContactDate)}
            />
            <Fact label="Active" value={person.isActive ? 'Yes' : 'No'} />
            <Fact label="Shepherds" value={person.shepherds.map((s) => s.name).join(', ')} />
          </dl>
          <div className="card-actions">
            <ContactedTodayButton person={person} />
            <button type="button" className="link" onClick={() => setEditing(true)}>
              Edit details
            </button>
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

function ContactedTodayButton({ person }: { person: Person }) {
  const [updatePerson, { loading, error }] = useUpdatePersonMutation()
  const today = todayIsoDate()

  if (person.lastContactDate === today) return null

  async function handleClick() {
    try {
      await updatePerson({ variables: { id: person.id, input: { lastContactDate: today } } })
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <span className="action">
      <button type="button" className="link" disabled={loading} onClick={handleClick}>
        {loading ? 'Saving…' : 'Contacted today'}
      </button>
      <ErrorMessage error={error} />
    </span>
  )
}

const toText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value)
const toNumber = (value: string) => (value === '' ? null : Number(value))

function EditPersonForm({ person, onDone }: { person: Person; onDone: () => void }) {
  const { data: statusData } = useStatusesQuery()
  // The result carries PersonSummary, which the cache merges into this person.
  const [updatePerson, { loading, error }] = useUpdatePersonMutation()

  const [name, setName] = useState(person.name)
  const [statusId, setStatusId] = useState(person.status.id)
  const [age, setAge] = useState(toText(person.age))
  const [yearMet, setYearMet] = useState(toText(person.yearMet))
  const [lastContactDate, setLastContactDate] = useState(toText(person.lastContactDate))
  const [isActive, setIsActive] = useState(person.isActive)

  /** Only what the user changed, so a concurrent edit by another shepherd isn't overwritten. */
  function changes(): UpdatePersonInput {
    const input: UpdatePersonInput = {}
    if (name.trim() !== person.name) input.name = name.trim()
    if (statusId !== person.status.id) input.statusId = statusId
    if (toNumber(age) !== person.age) input.age = toNumber(age)
    if (toNumber(yearMet) !== person.yearMet) input.yearMet = toNumber(yearMet)
    if ((lastContactDate || null) !== person.lastContactDate) {
      input.lastContactDate = lastContactDate || null
    }
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
      <label>
        <span>
          Last contact{' '}
          {person.lastContactDate === null && <span className="muted">(optional)</span>}
        </span>
        <input
          type="date"
          max={todayIsoDate()}
          value={lastContactDate}
          onChange={(e) => setLastContactDate(e.target.value)}
          required={person.lastContactDate !== null}
        />
      </label>
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
