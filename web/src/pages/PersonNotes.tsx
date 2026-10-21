import { useId, useState, type FormEvent } from 'react'
import { Alert, Button, TextArea } from '../components'
import { friendlyMessage } from '../errors'
import { firstName, formatShortDate } from '../format'
import {
  useCreateCommentMutation,
  useDeleteCommentMutation,
  type PersonQuery,
} from '../generated/graphql'
import { ActionButton } from './ActionButton'
import styles from './PersonNotes.module.css'
import section from './PersonSection.module.css'
import { CommentItem } from './PrayerThread'
import { refetchPersonAndPrayerLists } from './refetchPerson'

type Person = NonNullable<PersonQuery['person']>

/**
 * The Notes section: the add box, then comments not linked to a burden, newest first (business
 * rule 5). A note written when logging a contact is one of them, badged with its date.
 */
export function PersonNotes({
  person,
  meId,
  fieldId,
}: {
  person: Person
  meId: string | undefined
  /** The textarea's id, which phones' "Add note" in the header card focuses. */
  fieldId: string
}) {
  const headingId = useId()
  const now = new Date()
  const notes = person.comments.filter((c) => !c.prayerBurden)
  const contactedAt = (contactLogId: string) =>
    person.contacts.find((c) => c.id === contactLogId)?.contactedAt

  return (
    <section className={section.card} aria-labelledby={headingId}>
      <div className={section.head}>
        <h2 id={headingId} className={section.title}>
          Notes
        </h2>
      </div>
      <NoteForm person={person} fieldId={fieldId} />
      {notes.length === 0 ? (
        <p className={styles.empty}>
          No notes yet. A comment written when you log a contact shows here.
        </p>
      ) : (
        <ul className={styles.list}>
          {notes.map((c) => {
            const contactDate = c.contactLogId ? contactedAt(c.contactLogId) : undefined
            return (
              <li key={c.id}>
                <CommentItem
                  comment={c}
                  meId={meId}
                  now={now}
                  badge={
                    c.contactLogId && (
                      <span className={styles.badge}>
                        Logged contact{contactDate && ` · ${formatShortDate(contactDate)}`}
                      </span>
                    )
                  }
                >
                  {c.author.id === meId && <DeleteCommentButton id={c.id} personId={person.id} />}
                </CommentItem>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** A standalone note (no burden); clears itself once it is saved. Blank text sends nothing. */
function NoteForm({ person, fieldId }: { person: Person; fieldId: string }) {
  const [content, setContent] = useState('')
  const [createComment, { loading, error }] = useCreateCommentMutation(
    refetchPersonAndPrayerLists(person.id),
  )
  const trimmed = content.trim()
  const prompt = `Write a note about ${firstName(person.name)}`

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || loading) return
    try {
      await createComment({
        variables: { input: { personId: person.id, prayerBurdenId: null, content: trimmed } },
      })
      setContent('')
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <TextArea
        id={fieldId}
        label={<span className={styles.srOnly}>{prompt}</span>}
        placeholder={prompt}
        className={styles.field}
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      <Button type="submit" className={styles.submit} disabled={!trimmed || loading}>
        {loading ? 'Adding…' : 'Add note'}
      </Button>
    </form>
  )
}

/** Only rendered on the signed-in user's own comments; the API enforces it too. */
export function DeleteCommentButton({ id, personId }: { id: string; personId: string }) {
  const [deleteComment, { loading, error }] = useDeleteCommentMutation(
    refetchPersonAndPrayerLists(personId),
  )

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
