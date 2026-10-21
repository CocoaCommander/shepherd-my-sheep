import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ApolloError } from '@apollo/client'
import { errorCode, friendlyMessage } from '../errors'
import { formatDateTime, formatShortDate, isToday } from '../format'
import {
  useCreateCommentMutation,
  useCreatePrayerBurdenMutation,
  useDeleteCommentMutation,
  useMeQuery,
  usePersonQuery,
  useReleasePrayerBurdenMutation,
  type PersonQuery,
} from '../generated/graphql'
import { NARROW, useMediaQuery } from '../useMediaQuery'
import { ActionButton } from './ActionButton'
import { useLogContactToast } from './contactToast'
import { ErrorMessage } from './ErrorMessage'
import { Header } from './Header'
import { LogContactDialog } from './LogContactDialog'
import { PersonHeaderCard } from './PersonHeaderCard'
import { PersonMilestones } from './PersonMilestones'
import styles from './PersonPage.module.css'
import { PersonSidebar } from './PersonSidebar'
import { PersonStatusSelect } from './PersonStatusSelect'
import { refetchPerson } from './refetchPerson'
import { sharedWithShepherds } from './sharing'
import { useStatusMove } from './useStatusMove'

export function PersonPage() {
  const { id = '' } = useParams()
  const { data, loading, error } = usePersonQuery({ variables: { id } })
  const { data: meData } = useMeQuery()
  // A malformed id in the URL is rejected as bad input; to the user it's
  // the same as someone who doesn't exist.
  const notFound =
    (data && !data.person) || ['BAD_USER_INPUT', 'NOT_FOUND'].includes(errorCode(error) ?? '')

  return (
    <>
      <Header />
      <main className="page stack">
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link to="/people">My people</Link>
          {data?.person && (
            <>
              {' '}
              <span aria-hidden="true">/</span> {data.person.name}
            </>
          )}
        </nav>

        {loading && <p className="muted">Loading…</p>}
        {error && !notFound && (
          <p className="error" role="alert">
            {friendlyMessage(error)}
          </p>
        )}

        {/* null for someone who doesn't exist or isn't assigned to you */}
        {notFound && <p className="empty">This person was not found.</p>}

        {data?.person && <PersonDetail person={data.person} meId={meData?.me.id} />}
      </main>
    </>
  )
}

type Person = NonNullable<PersonQuery['person']>
type Comment = Person['comments'][number]

/** Set by Add person's "Log contact now", to open the dialog on arrival. */
type PersonLocationState = { logContact?: boolean } | null

function PersonDetail({ person, meId }: { person: Person; meId: string | undefined }) {
  const location = useLocation()
  const navigate = useNavigate()
  const askedToLog = Boolean((location.state as PersonLocationState)?.logContact)
  const [logging, setLogging] = useState(askedToLog)
  const narrow = useMediaQuery(NARROW)
  const { show, showLogged, toastElement } = useLogContactToast({ floating: true })
  // New contact → Active opens Log contact; saving it does the move, Cancel leaves the status.
  const { move, canMove } = useStatusMove<Person>({
    show,
    narrow,
    onLogContact: () => setLogging(true),
  })
  // In the header card on the web, in Details on phones; only one is in the DOM.
  const statusSelect = (label?: string) => (
    <PersonStatusSelect
      person={person}
      disabled={!canMove}
      onMove={(to) => move(person, to)}
      label={label}
    />
  )
  const notesFieldId = useId()

  // Clear the request, so Back or a reload doesn't open the dialog again.
  useEffect(() => {
    if (askedToLog) navigate(location.pathname, { replace: true, state: null })
  }, [askedToLog, location.pathname, navigate])

  const activeBurdens = person.prayerBurdens.filter((b) => !b.releasedDate)
  const releasedBurdens = person.prayerBurdens.filter((b) => b.releasedDate)
  const commentsFor = (burdenId: string) =>
    person.comments.filter((c) => c.prayerBurden?.id === burdenId)
  const notes = person.comments.filter((c) => !c.prayerBurden)
  const contactedAt = (contactLogId: string) =>
    person.contacts.find((c) => c.id === contactLogId)?.contactedAt

  return (
    <>
      <PersonHeaderCard
        person={person}
        meId={meId}
        notesFieldId={notesFieldId}
        statusSelect={narrow ? undefined : statusSelect()}
        onLogContact={() => setLogging(true)}
      />
      {/* LogContact returns the person's activity, so the cache updates this page. */}
      <LogContactDialog
        person={person}
        open={logging}
        onClose={() => setLogging(false)}
        onSaved={(saved, wasNewContact) => {
          setLogging(false)
          showLogged(saved, wasNewContact)
        }}
      />
      {toastElement}

      <div className={styles.columns}>
        <div className={styles.main}>
          <PersonMilestones person={person} narrow={narrow} />

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
            <p className="muted small">{sharedWithShepherds(person.name)}</p>
          </section>

          <section className="card stack">
            <h2>Notes</h2>
            {notes.length === 0 ? (
              <p className="empty">No notes yet.</p>
            ) : (
              <ul className="list">
                {notes.map((c) => (
                  <li key={c.id} className="list-item">
                    {c.contactLogId && (
                      <LoggedContactLabel contactedAt={contactedAt(c.contactLogId)} />
                    )}
                    <div className="item-head">
                      <p>{c.content}</p>
                      {c.author.id === meId && (
                        <DeleteCommentButton id={c.id} personId={person.id} />
                      )}
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
              fieldId={notesFieldId}
            />
          </section>
        </div>
        <PersonSidebar
          person={person}
          meId={meId}
          statusSelect={narrow ? statusSelect('Status') : undefined}
        />
      </div>
    </>
  )
}

/** Marks a note written when logging a contact, with the contact's date. */
function LoggedContactLabel({ contactedAt }: { contactedAt: string | undefined }) {
  return (
    <p className="muted small">
      Logged contact{contactedAt && ` · ${formatShortDate(contactedAt)}`}
    </p>
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
      <p className="muted small">
        Added {isToday(burden.createdAt) ? 'today' : formatDateTime(burden.createdAt)}
        {!released && comments.length === 0 && ' · Praying'}
      </p>
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
  fieldId,
}: {
  personId: string
  prayerBurdenId: string | null
  label: string
  submitLabel: string
  compact?: boolean
  /** The textarea's id, for something else on the page to focus it. */
  fieldId?: string
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
      fieldId={fieldId}
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
  fieldId,
  onSubmit,
}: {
  label: string
  submitLabel: string
  busyLabel: string
  loading: boolean
  error: ApolloError | undefined
  compact?: boolean
  fieldId?: string
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
          id={fieldId}
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
