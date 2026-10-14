import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ApolloError } from '@apollo/client'
import { formatDate, formatDateTime } from '../format'
import {
  PersonDocument,
  useCreateCommentMutation,
  useCreatePrayerBurdenMutation,
  useDeleteCommentMutation,
  useMeQuery,
  useMilestonesQuery,
  usePersonQuery,
  useRecordMilestoneMutation,
  useReleasePrayerBurdenMutation,
  useRemoveMilestoneMutation,
  type PersonQuery,
} from '../generated/graphql'
import { ErrorMessage } from './ErrorMessage'
import { Header } from './Header'
import { PersonDetailsCard } from './PersonDetailsCard'

export function PersonPage() {
  const { id = '' } = useParams()
  const { data, loading, error } = usePersonQuery({ variables: { id } })
  const { data: meData } = useMeQuery()

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

        {data?.person && <PersonDetail person={data.person} meId={meData?.me.id} />}
      </main>
    </>
  )
}

type Person = NonNullable<PersonQuery['person']>
type Comment = Person['comments'][number]

/** Every change on this page reloads the person, so all sections stay in step. */
function refetchPerson(personId: string) {
  return {
    refetchQueries: [{ query: PersonDocument, variables: { id: personId } }],
    awaitRefetchQueries: true,
  }
}

function PersonDetail({ person, meId }: { person: Person; meId: string | undefined }) {
  const activeBurdens = person.prayerBurdens.filter((b) => !b.releasedDate)
  const releasedBurdens = person.prayerBurdens.filter((b) => b.releasedDate)
  const commentsFor = (burdenId: string) =>
    person.comments.filter((c) => c.prayerBurden?.id === burdenId)
  const notes = person.comments.filter((c) => !c.prayerBurden)

  return (
    <>
      <PersonDetailsCard person={person} />

      <section className="card stack">
        <h2>Milestones</h2>
        {person.milestones.length === 0 ? (
          // Someone we've just met has none (business rule 2).
          <p className="empty">No milestones yet.</p>
        ) : (
          <ul className="list">
            {person.milestones.map((m) => (
              <li key={m.id} className="list-item">
                <div className="item-head">
                  <span>
                    <strong>{m.milestone.name}</strong>
                    {m.dateAchieved && (
                      <span className="muted"> · {formatDate(m.dateAchieved)}</span>
                    )}
                  </span>
                  <RemoveMilestoneButton
                    personId={person.id}
                    milestoneId={m.milestone.id}
                    name={m.milestone.name}
                  />
                </div>
                {m.notes && <p>{m.notes}</p>}
                {m.recordedBy && <p className="muted small">Recorded by {m.recordedBy.name}</p>}
              </li>
            ))}
          </ul>
        )}
        <RecordMilestoneForm
          personId={person.id}
          recordedIds={person.milestones.map((m) => m.milestone.id)}
        />
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
                    personId={person.id}
                    burden={b}
                    comments={commentsFor(b.id)}
                    meId={meId}
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
                      personId={person.id}
                      burden={b}
                      comments={commentsFor(b.id)}
                      meId={meId}
                    />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <AddPrayerBurdenForm personId={person.id} />
      </section>

      <section className="card stack">
        <h2>Notes</h2>
        {notes.length === 0 ? (
          <p className="empty">No notes yet.</p>
        ) : (
          <ul className="list">
            {notes.map((c) => (
              <li key={c.id} className="list-item">
                <div className="item-head">
                  <p>{c.content}</p>
                  {c.author.id === meId && <DeleteCommentButton id={c.id} personId={person.id} />}
                </div>
                <p className="muted small">
                  {c.author.name} · {formatDateTime(c.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {/* A comment needn't link to a burden (business rule 5). */}
        <CommentForm
          personId={person.id}
          prayerBurdenId={null}
          label="New note"
          submitLabel="Add note"
        />
      </section>
    </>
  )
}

function Burden({
  personId,
  burden,
  comments,
  meId,
}: {
  personId: string
  burden: Person['prayerBurdens'][number]
  comments: Comment[]
  meId: string | undefined
}) {
  const released = Boolean(burden.releasedDate)

  return (
    <li className={`list-item${released ? ' released' : ''}`}>
      <div className="item-head">
        <p>{burden.content}</p>
        {!released && <ReleaseBurdenButton id={burden.id} personId={personId} />}
      </div>
      <p className="muted small">Added {formatDateTime(burden.createdAt)}</p>
      {/* A burden may have no comments (business rule 4). */}
      {comments.length > 0 && (
        <ul className="replies">
          {comments.map((c) => (
            <li key={c.id}>
              {c.content}{' '}
              <span className="muted small">
                — {c.author.name}, {formatDateTime(c.createdAt)}
              </span>
              {c.author.id === meId && <DeleteCommentButton id={c.id} personId={personId} />}
            </li>
          ))}
        </ul>
      )}
      {!released && (
        <CommentForm
          personId={personId}
          prayerBurdenId={burden.id}
          label="Comment"
          submitLabel="Add comment"
          compact
        />
      )}
    </li>
  )
}

// ── Forms ────────────────────────────────────────────────────

function RecordMilestoneForm({
  personId,
  recordedIds,
}: {
  personId: string
  recordedIds: string[]
}) {
  const { data } = useMilestonesQuery()
  const [recordMilestone, { loading, error }] = useRecordMilestoneMutation(refetchPerson(personId))

  const [milestoneId, setMilestoneId] = useState('')
  const [dateAchieved, setDateAchieved] = useState('')
  const [notes, setNotes] = useState('')

  // Each milestone can be recorded once per person.
  const options = (data?.milestones ?? []).filter((m) => !recordedIds.includes(m.id))
  const selected = options.some((m) => m.id === milestoneId) ? milestoneId : (options[0]?.id ?? '')

  if (options.length === 0) return null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await recordMilestone({
        variables: {
          input: {
            personId,
            milestoneId: selected,
            dateAchieved: dateAchieved || null,
            notes: notes.trim() || null,
          },
        },
      })
      setMilestoneId('')
      setDateAchieved('')
      setNotes('')
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form className="stack subform" onSubmit={handleSubmit}>
      <h3>Record a milestone</h3>
      <div className="row">
        <label>
          Milestone
          <select value={selected} onChange={(e) => setMilestoneId(e.target.value)} required>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Date achieved <span className="muted">(optional)</span>
          </span>
          <input
            type="date"
            value={dateAchieved}
            onChange={(e) => setDateAchieved(e.target.value)}
          />
        </label>
      </div>
      <label>
        <span>
          Notes <span className="muted">(optional)</span>
        </span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <ErrorMessage error={error} />
      <button type="submit" disabled={loading || !selected}>
        {loading ? 'Recording…' : 'Record milestone'}
      </button>
    </form>
  )
}

function AddPrayerBurdenForm({ personId }: { personId: string }) {
  const [createPrayerBurden, { loading, error }] = useCreatePrayerBurdenMutation(
    refetchPerson(personId),
  )

  return (
    <TextEntryForm
      label="New prayer burden"
      submitLabel="Add prayer burden"
      busyLabel="Adding…"
      loading={loading}
      error={error}
      onSubmit={(content) => createPrayerBurden({ variables: { input: { personId, content } } })}
    />
  )
}

/** Links to `prayerBurdenId`, or is a standalone note when it is null. */
function CommentForm({
  personId,
  prayerBurdenId,
  label,
  submitLabel,
  compact = false,
}: {
  personId: string
  prayerBurdenId: string | null
  label: string
  submitLabel: string
  compact?: boolean
}) {
  const [createComment, { loading, error }] = useCreateCommentMutation(refetchPerson(personId))

  return (
    <TextEntryForm
      label={label}
      submitLabel={submitLabel}
      busyLabel="Adding…"
      loading={loading}
      error={error}
      compact={compact}
      onSubmit={(content) =>
        createComment({ variables: { input: { personId, prayerBurdenId, content } } })
      }
    />
  )
}

/** A textarea and a submit button; clears itself once `onSubmit` succeeds. */
function TextEntryForm({
  label,
  submitLabel,
  busyLabel,
  loading,
  error,
  compact = false,
  onSubmit,
}: {
  label: string
  submitLabel: string
  busyLabel: string
  loading: boolean
  error: ApolloError | undefined
  compact?: boolean
  onSubmit: (content: string) => Promise<unknown>
}) {
  const [content, setContent] = useState('')
  const trimmed = content.trim()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      await onSubmit(trimmed)
      setContent('')
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form className={`stack subform${compact ? ' compact' : ''}`} onSubmit={handleSubmit}>
      <label>
        {label}
        <textarea
          rows={compact ? 1 : 2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
      </label>
      <ErrorMessage error={error} />
      <button type="submit" disabled={loading || !trimmed}>
        {loading ? busyLabel : submitLabel}
      </button>
    </form>
  )
}

// ── Item actions ─────────────────────────────────────────────

function RemoveMilestoneButton({
  personId,
  milestoneId,
  name,
}: {
  personId: string
  milestoneId: string
  name: string
}) {
  const [removeMilestone, { loading, error }] = useRemoveMilestoneMutation(refetchPerson(personId))

  return (
    <ActionButton
      label="Remove"
      ariaLabel={`Remove ${name}`}
      question="Remove this milestone?"
      confirmLabel="Yes, remove"
      loading={loading}
      error={error}
      onClick={() => removeMilestone({ variables: { personId, milestoneId } })}
    />
  )
}

function ReleaseBurdenButton({ id, personId }: { id: string; personId: string }) {
  const [releasePrayerBurden, { loading, error }] = useReleasePrayerBurdenMutation(
    refetchPerson(personId),
  )

  return (
    <ActionButton
      label="Release"
      question="Release this prayer burden?"
      confirmLabel="Yes, release"
      loading={loading}
      error={error}
      onClick={() => releasePrayerBurden({ variables: { id } })}
    />
  )
}

/** Only rendered on the signed-in user's own comments; the API enforces it too. */
function DeleteCommentButton({ id, personId }: { id: string; personId: string }) {
  const [deleteComment, { loading, error }] = useDeleteCommentMutation(refetchPerson(personId))

  return (
    <ActionButton
      label="Delete"
      question="Delete this comment?"
      confirmLabel="Yes, delete"
      loading={loading}
      error={error}
      onClick={() => deleteComment({ variables: { id } })}
    />
  )
}

/** A destructive action that asks inline before it runs; nothing happens on Cancel. */
function ActionButton({
  label,
  ariaLabel,
  question,
  confirmLabel,
  loading,
  error,
  onClick,
}: {
  label: string
  ariaLabel?: string
  question: string
  confirmLabel: string
  loading: boolean
  error: ApolloError | undefined
  onClick: () => Promise<unknown>
}) {
  const [confirming, setConfirming] = useState(false)

  async function handleConfirm() {
    try {
      await onClick()
    } catch {
      // Shown from the mutation's `error` below.
    }
    setConfirming(false)
  }

  return (
    <span className="action">
      {confirming ? (
        <span className="confirm">
          <span className="small">{question}</span>
          <button type="button" className="link danger" disabled={loading} onClick={handleConfirm}>
            {loading ? 'Working…' : confirmLabel}
          </button>
          <button
            type="button"
            className="link"
            disabled={loading}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="link"
          aria-label={ariaLabel}
          onClick={() => setConfirming(true)}
        >
          {label}
        </button>
      )}
      <ErrorMessage error={error} />
    </span>
  )
}
