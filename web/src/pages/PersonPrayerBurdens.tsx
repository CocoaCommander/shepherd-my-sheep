import { useId, useState, type ReactNode } from 'react'
import { Alert, Button, PlusIcon } from '../components'
import { cx } from '../components/utils'
import { dateAgo, firstName, timeAgo } from '../format'
import type { PersonQuery } from '../generated/graphql'
import { DeleteCommentButton } from './PersonNotes'
import styles from './PersonPrayerBurdens.module.css'
import section from './PersonSection.module.css'
import { AddBurdenDialog, BurdenCommentForm, Thread, useReleaseBurden } from './PrayerThread'
import { refetchPersonAndPrayerLists } from './refetchPerson'
import { sharedWithShepherds } from './sharing'

type Person = NonNullable<PersonQuery['person']>
type Burden = Person['prayerBurdens'][number]
type Comment = Person['comments'][number]

/**
 * The Prayer burdens section: active burdens with their threads, then the released ones folded
 * away. A person may have none (business rule 3), and a burden no comments (rule 4).
 */
export function PersonPrayerBurdens({
  person,
  meId,
  narrow,
  show,
}: {
  person: Person
  meId: string | undefined
  narrow: boolean
  /** The page's toast, shared with its other messages. */
  show: (message: ReactNode, onUndo?: () => void) => void
}) {
  const headingId = useId()
  const [adding, setAdding] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const reload = refetchPersonAndPrayerLists(person.id)
  const release = useReleaseBurden(show, reload)
  const now = new Date()

  // The API sends active burdens first, each group newest first.
  const active = person.prayerBurdens.filter((b) => !b.releasedDate)
  const released = person.prayerBurdens.filter((b) => b.releasedDate)
  // Newest first, as the API sends them.
  const commentsFor = (burdenId: string) =>
    person.comments.filter((c) => c.prayerBurden?.id === burdenId)

  const onRelease = (burden: Burden) => {
    setReleaseError(null)
    release(burden.id, person.name, { failed: setReleaseError })
  }

  return (
    <section className={section.card} aria-labelledby={headingId}>
      <div className={cx(section.head, styles.head)}>
        <h2 id={headingId} className={section.title}>
          Prayer burdens
        </h2>
        {/* Phones show just "Add"; the name stays "Add burden", starting with the visible text. */}
        <Button
          variant="secondary"
          icon={<PlusIcon />}
          aria-label={narrow ? 'Add burden' : undefined}
          onClick={() => setAdding(true)}
        >
          {narrow ? 'Add' : 'Add burden'}
        </Button>
      </div>

      {releaseError && <Alert variant="inline">{releaseError}</Alert>}

      {active.length === 0 ? (
        <p className={styles.empty}>
          {narrow
            ? 'No prayer burdens yet.'
            : 'No prayer burdens yet. Add one here, or when you log a contact.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {active.map((b) => (
            <ActiveBurden
              key={b.id}
              burden={b}
              personId={person.id}
              comments={commentsFor(b.id)}
              meId={meId}
              narrow={narrow}
              now={now}
              reload={reload}
              onRelease={() => onRelease(b)}
            />
          ))}
        </ul>
      )}

      <p className={styles.shared}>{sharedWithShepherds(person.name)}</p>

      {released.length > 0 && (
        <details className={styles.released}>
          <summary>Released ({released.length})</summary>
          <ul className={styles.releasedList}>
            {released.map((b) => (
              <ReleasedBurden key={b.id} burden={b} latest={commentsFor(b.id)[0]} now={now} />
            ))}
          </ul>
        </details>
      )}

      {adding && (
        <AddBurdenDialog
          people={[person]}
          fixed
          reload={reload}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            show(`Added prayer burden for ${firstName(person.name)}`)
          }}
        />
      )}
    </section>
  )
}

function ActiveBurden({
  burden,
  personId,
  comments,
  meId,
  narrow,
  now,
  reload,
  onRelease,
}: {
  burden: Burden
  personId: string
  comments: Comment[]
  meId: string | undefined
  narrow: boolean
  now: Date
  reload: ReturnType<typeof refetchPersonAndPrayerLists>
  onRelease: () => void
}) {
  const contentId = useId()
  // Named "Release"; the burden it releases is its description.
  const releaseButton = (
    <Button variant="secondary" aria-describedby={contentId} onClick={onRelease}>
      Release
    </Button>
  )

  return (
    <li className={styles.burden}>
      <div className={styles.burdenHead}>
        <div className={styles.burdenText}>
          <p id={contentId} className={styles.content}>
            {burden.content}
          </p>
          <p className={styles.meta}>Added {timeAgo(burden.createdAt, now)} · Praying</p>
        </div>
        {/* The web has Release at the top right; phones put it beside Comment. */}
        {!narrow && releaseButton}
      </div>
      <Thread
        comments={comments}
        meId={meId}
        now={now}
        actions={(c) =>
          c.author.id === meId && <DeleteCommentButton id={c.id} personId={personId} />
        }
      >
        <BurdenCommentForm
          personId={personId}
          burdenId={burden.id}
          reload={reload}
          placeholder={narrow ? 'Add a comment' : undefined}
          extra={narrow && releaseButton}
        />
      </Thread>
    </li>
  )
}

/** Read-only: the text, when it was added and released, and its latest comment only. */
function ReleasedBurden({
  burden,
  latest,
  now,
}: {
  burden: Burden
  latest: Comment | undefined
  now: Date
}) {
  return (
    <li className={styles.releasedItem}>
      <p className={styles.content}>{burden.content}</p>
      <p className={styles.meta}>
        Added {timeAgo(burden.createdAt, now)}
        {/* releasedDate is a Date ("YYYY-MM-DD"), so dateAgo, not timeAgo. */}
        {burden.releasedDate && ` · Released ${dateAgo(burden.releasedDate, now)}`}
      </p>
      {latest && <p className={styles.latest}>{latest.content}</p>}
    </li>
  )
}
