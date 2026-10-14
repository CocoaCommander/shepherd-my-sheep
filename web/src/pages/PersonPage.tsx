import { Link, useParams } from 'react-router-dom'
import { formatDate, formatDateTime } from '../format'
import { usePersonQuery, type PersonQuery } from '../generated/graphql'
import { Header } from './Header'

export function PersonPage() {
  const { id = '' } = useParams()
  const { data, loading, error } = usePersonQuery({ variables: { id } })

  return (
    <>
      <Header />
      <main className="page stack">
        <Link to="/" className="back">
          ← My people
        </Link>

        {loading && <p className="muted">Loading…</p>}
        {error && (
          <p className="error" role="alert">
            {error.message}
          </p>
        )}

        {/* null for someone who doesn't exist or isn't assigned to you */}
        {data && !data.person && <p className="empty">This person was not found.</p>}

        {data?.person && <PersonDetail person={data.person} />}
      </main>
    </>
  )
}

type Person = NonNullable<PersonQuery['person']>

function PersonDetail({ person }: { person: Person }) {
  const activeBurdens = person.prayerBurdens.filter((b) => !b.releasedDate)
  const releasedBurdens = person.prayerBurdens.filter((b) => b.releasedDate)
  const commentsFor = (burdenId: string) =>
    person.comments.filter((c) => c.prayerBurden?.id === burdenId)
  const notes = person.comments.filter((c) => !c.prayerBurden)

  return (
    <>
      <section className="card">
        <div className="title-row">
          <h1>{person.name}</h1>
          <span className={`badge${person.isActive ? '' : ' badge-muted'}`}>
            {person.status.name}
          </span>
        </div>
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
      </section>

      <section className="card stack">
        <h2>Milestones</h2>
        {person.milestones.length === 0 ? (
          // Someone we've just met has none (business rule 2).
          <p className="empty">No milestones yet.</p>
        ) : (
          <ul className="list">
            {person.milestones.map((m) => (
              <li key={m.id} className="list-item">
                <strong>{m.milestone.name}</strong>
                {m.dateAchieved && <span className="muted"> · {formatDate(m.dateAchieved)}</span>}
                {m.notes && <p>{m.notes}</p>}
                {m.recordedBy && <p className="muted small">Recorded by {m.recordedBy.name}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>Prayer burdens</h2>
        {person.prayerBurdens.length === 0 ? (
          // Burdens are added over time (business rule 3).
          <p className="empty">No prayer burdens yet.</p>
        ) : (
          <>
            {activeBurdens.length > 0 && (
              <ul className="list">
                {activeBurdens.map((b) => (
                  <Burden
                    key={b.id}
                    content={b.content}
                    createdAt={b.createdAt}
                    comments={commentsFor(b.id)}
                  />
                ))}
              </ul>
            )}
            {releasedBurdens.length > 0 && (
              <details>
                <summary className="muted">Released ({releasedBurdens.length})</summary>
                <ul className="list">
                  {releasedBurdens.map((b) => (
                    <Burden
                      key={b.id}
                      content={b.content}
                      createdAt={b.createdAt}
                      comments={commentsFor(b.id)}
                      released
                    />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Notes</h2>
        {notes.length === 0 ? (
          <p className="empty">No notes yet.</p>
        ) : (
          <ul className="list">
            {notes.map((c) => (
              <li key={c.id} className="list-item">
                <p>{c.content}</p>
                <p className="muted small">
                  {c.author.name} · {formatDateTime(c.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
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

function Burden({
  content,
  createdAt,
  comments,
  released = false,
}: {
  content: string
  createdAt: string
  comments: Person['comments']
  released?: boolean
}) {
  return (
    <li className={`list-item${released ? ' released' : ''}`}>
      <p>{content}</p>
      <p className="muted small">Added {formatDateTime(createdAt)}</p>
      {/* A burden may have no comments (business rule 4). */}
      {comments.length > 0 && (
        <ul className="replies">
          {comments.map((c) => (
            <li key={c.id}>
              {c.content}{' '}
              <span className="muted small">
                — {c.author.name}, {formatDateTime(c.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
