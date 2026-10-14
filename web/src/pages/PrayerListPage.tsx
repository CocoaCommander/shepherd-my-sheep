import { Link } from 'react-router-dom'
import { friendlyMessage } from '../errors'
import { formatDateTime } from '../format'
import { useActivePrayerBurdensQuery, type ActivePrayerBurdensQuery } from '../generated/graphql'
import { Header } from './Header'

type Burden = ActivePrayerBurdensQuery['activePrayerBurdens'][number]

/** Burdens grouped by person, people A→Z; each group keeps the API's newest-first order. */
function groupByPerson(burdens: Burden[]) {
  const groups = new Map<string, { person: Burden['person']; burdens: Burden[] }>()
  for (const burden of burdens) {
    const group = groups.get(burden.person.id)
    if (group) group.burdens.push(burden)
    else groups.set(burden.person.id, { person: burden.person, burdens: [burden] })
  }
  return [...groups.values()].sort((a, b) => a.person.name.localeCompare(b.person.name))
}

/** Everything to pray for, across all of the user's people. */
export function PrayerListPage() {
  // Burdens are added and released on person pages, so don't trust the cache alone.
  const { data, loading, error } = useActivePrayerBurdensQuery({
    fetchPolicy: 'cache-and-network',
  })
  const groups = groupByPerson(data?.activePrayerBurdens ?? [])

  return (
    <>
      <Header />
      <main className="page stack">
        <h1>Prayer list</h1>

        {loading && !data && <p className="muted">Loading…</p>}
        {error && (
          <p className="error" role="alert">
            {friendlyMessage(error)}
          </p>
        )}

        {data && groups.length === 0 && (
          // No one may have burdens yet (business rule 3).
          <div>
            <p className="empty">No active prayer burdens.</p>
            <p className="muted small">Add them from a person&apos;s page.</p>
          </div>
        )}

        {groups.map(({ person, burdens }) => (
          <section key={person.id} className="card stack">
            <h2>
              <Link to={`/people/${person.id}`}>{person.name}</Link>
            </h2>
            <ul className="list">
              {burdens.map((b) => (
                <li key={b.id} className="list-item">
                  <p>{b.content}</p>
                  <p className="muted small">Added {formatDateTime(b.createdAt)}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  )
}
