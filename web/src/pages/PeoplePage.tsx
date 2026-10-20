import { Link } from 'react-router-dom'
import { Button, PlusIcon } from '../components'
import { useMyPeopleQuery } from '../generated/graphql'
import { friendlyMessage } from '../errors'
import { ContactStateBadge } from './ContactStateBadge'
import { Header } from './Header'

export function PeoplePage() {
  const { data, loading, error } = useMyPeopleQuery()

  return (
    <>
      <Header />
      <main className="page stack">
        <h1>My people</h1>

        {loading && <p className="muted">Loading…</p>}
        {error && (
          <p className="error" role="alert">
            {friendlyMessage(error)}
          </p>
        )}

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
                  <span className="badges">
                    <ContactStateBadge person={person} />
                    <span className={`badge${person.isActive ? '' : ' badge-muted'}`}>
                      {person.status.name}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Wrapped so the column doesn't stretch it full width. */}
        <div>
          <Button as={Link} to="/people/new" icon={<PlusIcon />}>
            Add person
          </Button>
        </div>
      </main>
    </>
  )
}
