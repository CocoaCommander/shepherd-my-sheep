// The prayer burden pieces the Prayer list and the Person page share: a burden's comment thread,
// its comment box, Release with Undo, and the Add prayer burden dialog.
import { useCallback, useId, useState, type FormEvent, type ReactNode } from 'react'
import type { ApolloCache, ApolloError, InternalRefetchQueriesInclude } from '@apollo/client'
import { Alert, Button, Dialog, initials, Select, TextArea, TextField } from '../components'
import { friendlyMessage } from '../errors'
import { firstName, timeAgo } from '../format'
import {
  useCreateCommentMutation,
  useCreatePrayerBurdenMutation,
  useReleasePrayerBurdenMutation,
  useUnreleasePrayerBurdenMutation,
} from '../generated/graphql'
import styles from './PrayerThread.module.css'
import { sharedWithShepherds } from './sharing'

/** What each page refetches or updates after a change; passed to every mutation here. */
export type Reload = {
  refetchQueries?: InternalRefetchQueriesInclude
  awaitRefetchQueries?: boolean
  update?: (cache: ApolloCache<unknown>) => void
}

/** A comment as both pages select it. */
export type ThreadComment = {
  id: string
  content: string
  createdAt: string
  author: { id: string; name: string }
}

/** The useUndoToast `show` of the page, so its toasts never stack. */
type Show = (message: ReactNode, onUndo?: () => void) => void

export const commentAuthor = (comment: ThreadComment, meId?: string) =>
  comment.author.id === meId ? 'You' : comment.author.name

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * A burden's comments (given newest first, as the API sends them) shown oldest first, with the
 * latest two shown until asked for the rest. A burden may have none (business rule 4). The
 * comment box goes in `children`; `actions` adds controls to a comment, e.g. Delete.
 */
export function Thread({
  id,
  comments,
  meId,
  now,
  hideDetails = false,
  actions,
  className,
  children,
}: {
  id?: string
  comments: readonly ThreadComment[]
  meId?: string
  now: Date
  hideDetails?: boolean
  actions?: (comment: ThreadComment) => ReactNode
  className?: string
  children?: ReactNode
}) {
  const [showAll, setShowAll] = useState(false)
  const oldestFirst = [...comments].reverse()
  const earlier = Math.max(0, oldestFirst.length - 2)
  const shown = showAll ? oldestFirst : oldestFirst.slice(earlier)

  return (
    <div id={id} className={className ?? styles.thread}>
      {earlier > 0 && (
        <Button variant="text" className={styles.earlier} onClick={() => setShowAll((s) => !s)}>
          {showAll
            ? 'Hide earlier comments'
            : `Show ${plural(earlier, 'earlier comment', 'earlier comments')}`}
        </Button>
      )}
      {shown.length > 0 && (
        <ul className={styles.comments}>
          {shown.map((c) => (
            <li key={c.id}>
              <CommentItem comment={c} meId={meId} now={now} hideDetails={hideDetails}>
                {actions?.(c)}
              </CommentItem>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  )
}

/** Initials, "{author} · {ago}", then the text; `children` (e.g. a Delete) sits under the text. */
export function CommentItem({
  comment,
  meId,
  now,
  hideDetails = false,
  badge,
  children,
}: {
  comment: ThreadComment
  meId?: string
  now: Date
  hideDetails?: boolean
  /** Shown after the meta line, e.g. "Logged contact · Wed, Oct 15". */
  badge?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={styles.comment}>
      <span aria-hidden="true" className={styles.commentAvatar}>
        {initials(comment.author.name)}
      </span>
      <div className={styles.commentBody}>
        <p className={styles.commentMeta}>
          <span className={styles.commentAuthor}>{commentAuthor(comment, meId)}</span> ·{' '}
          {timeAgo(comment.createdAt, now)}
          {badge}
        </p>
        <p className={hideDetails ? styles.muted : undefined}>
          {hideDetails ? 'Details hidden' : comment.content}
        </p>
        {children}
      </div>
    </div>
  )
}

/**
 * Adds a comment linked to the burden; clears itself once it is saved. `extra` goes after the
 * Comment button, e.g. Release on phones.
 */
export function BurdenCommentForm({
  personId,
  burdenId,
  reload,
  help,
  placeholder = 'Add a comment on this burden',
  extra,
}: {
  personId: string
  burdenId: string
  reload: Reload
  help?: ReactNode
  placeholder?: string
  extra?: ReactNode
}) {
  const [content, setContent] = useState('')
  const [createComment, { loading, error }] = useCreateCommentMutation(reload)
  const trimmed = content.trim()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || loading) return
    try {
      await createComment({
        variables: { input: { personId, prayerBurdenId: burdenId, content: trimmed } },
      })
      setContent('')
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form className={styles.commentForm} onSubmit={handleSubmit}>
      <div className={styles.commentRow}>
        <TextField
          label={<span className={styles.srOnly}>Add a comment on this burden</span>}
          placeholder={placeholder}
          className={styles.commentField}
          help={help}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <Button type="submit" disabled={!trimmed || loading}>
          Comment
        </Button>
        {extra}
      </div>
      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
    </form>
  )
}

/**
 * Release at once, then a toast with Undo (no confirmation: Undo is the safeguard). The page
 * handles what's shown meanwhile through the callbacks.
 */
export function useReleaseBurden(show: Show, reload: Reload) {
  const [release] = useReleasePrayerBurdenMutation(reload)
  const [unrelease] = useUnreleasePrayerBurdenMutation(reload)

  return useCallback(
    (
      id: string,
      personName: string,
      on: {
        /** The release failed; with the friendly message. */
        failed?: (message: string) => void
        undone?: () => void
        undoFailed?: (error: ApolloError) => void
      } = {},
    ) => {
      release({ variables: { id } }).then(
        () =>
          show(`Released prayer burden for ${firstName(personName)}`, () => {
            unrelease({ variables: { id } }).then(
              () => on.undone?.(),
              (e) => {
                show(`Couldn't undo. ${friendlyMessage(e)}`)
                on.undoFailed?.(e)
              },
            )
          }),
        (e) => on.failed?.(friendlyMessage(e)),
      )
    },
    [release, unrelease, show],
  )
}

type DialogPerson = { id: string; name: string }

const byName = (a: DialogPerson, b: DialogPerson) =>
  a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)

/**
 * Adds a burden for one of `people`, starting on `initialPersonId` (or the only one). With a
 * single person and `fixed`, there's no person picker (the Person page). The host mounts it only
 * while open, so it starts empty each time.
 */
export function AddBurdenDialog({
  people,
  initialPersonId,
  fixed = false,
  reload,
  onClose,
  onAdded,
}: {
  people: readonly DialogPerson[]
  initialPersonId?: string
  fixed?: boolean
  reload: Reload
  onClose: () => void
  onAdded: (name: string) => void
}) {
  const formId = useId()
  const sorted = [...people].sort(byName)
  const [personId, setPersonId] = useState(
    initialPersonId ?? (sorted.length === 1 ? sorted[0].id : ''),
  )
  const [content, setContent] = useState('')
  const [createPrayerBurden, { loading, error }] = useCreatePrayerBurdenMutation(reload)
  const person = sorted.find((p) => p.id === personId)
  const trimmed = content.trim()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!person || !trimmed || loading) return
    try {
      await createPrayerBurden({ variables: { input: { personId: person.id, content: trimmed } } })
      onAdded(person.name)
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add prayer burden"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!person || !trimmed || loading}>
            {loading ? 'Adding…' : 'Add prayer burden'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.addForm} onSubmit={handleSubmit}>
        {!fixed && (
          <Select
            label="Person"
            className={styles.personField}
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
          >
            <option value="">Choose a person</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <TextArea
          label="Prayer burden"
          rows={3}
          value={content}
          help={sharedWithShepherds(person?.name)}
          onChange={(e) => setContent(e.target.value)}
        />
        {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      </form>
    </Dialog>
  )
}
