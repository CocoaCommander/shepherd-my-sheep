import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  MyPeopleDocument,
  useCreatePersonMutation,
  useMyPeopleQuery,
  useStatusesQuery,
} from '../generated/graphql'
import { Header } from './Header'

export function PeoplePage() {
  const { data, loading, error } = useMyPeopleQuery()

  return (
    <>
      <Header />
      <main className="page stack">
        <h1>My people</h1>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error" role="alert">{error.message}</p>}

        {data && data.myPeople.length === 0 && (
          // A new user has no one assigned yet (business rule 1).
          <p className="empty">No one is assigned to you yet. Add someone below.</p>
        )}

        {data && data.myPeople.length > 0 && (
          <ul className="list">
            {data.myPeople.map((person) => (
              <li key={person.id}>
                <Link to={`/people/${person.id}`} className="list-row">
                  <span>{person.name}</span>
                  <span className={`badge${person.isActive ? '' : ' badge-muted'}`}>{person.status.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <AddPersonForm />
      </main>
    </>
  )
}

function AddPersonForm() {
  const { data: statusData } = useStatusesQuery()
  const [createPerson, { loading, error }] = useCreatePersonMutation({
    refetchQueries: [{ query: MyPeopleDocument }],
  })

  const [name, setName] = useState('')
  const [statusId, setStatusId] = useState('')
  const [age, setAge] = useState('')
  const [yearMet, setYearMet] = useState('')

  const statuses = statusData?.statuses ?? []
  const selectedStatus = statusId || statuses.find((s) => s.name === 'new contact')?.id || statuses[0]?.id || ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await createPerson({
        variables: {
          input: {
            name: name.trim(),
            statusId: selectedStatus,
            age: age ? Number(age) : null,
            yearMet: yearMet ? Number(yearMet) : null,
          },
        },
      })
      setName('')
      setAge('')
      setYearMet('')
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h2>Add a person</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Status
        <select value={selectedStatus} onChange={(e) => setStatusId(e.target.value)} required>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <div className="row">
        <label>
          <span>Age <span className="muted">(optional)</span></span>
          <input type="number" min={0} max={150} value={age} onChange={(e) => setAge(e.target.value)} />
        </label>
        <label>
          <span>Year met <span className="muted">(optional)</span></span>
          <input type="number" min={1900} max={2100} value={yearMet} onChange={(e) => setYearMet(e.target.value)} />
        </label>
      </div>
      {error && <p className="error" role="alert">{error.message}</p>}
      <button type="submit" disabled={loading || !selectedStatus}>
        {loading ? 'Adding…' : 'Add person'}
      </button>
    </form>
  )
}
