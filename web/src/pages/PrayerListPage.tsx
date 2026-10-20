import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Avatar,
  avatarTint,
  Button,
  ClockIcon,
  Dialog,
  initials,
  PlusIcon,
  SegmentedControl,
  Select,
  StatusPill,
  Switch,
  TextArea,
  TextField,
  useUndoToast,
  type AvatarTint,
} from '../components'
import { errorCode, friendlyMessage } from '../errors'
import { firstName, parseDateTime, timeAgo } from '../format'
import {
  ActivePrayerBurdensDocument,
  MyPeopleDocument,
  RecentlyReleasedPrayerBurdensDocument,
  useActivePrayerBurdensQuery,
  useCreateCommentMutation,
  useCreatePrayerBurdenMutation,
  useMeQuery,
  useMyPeopleQuery,
  useRecentlyReleasedPrayerBurdensQuery,
  useReleasePrayerBurdenMutation,
  useUnreleasePrayerBurdenMutation,
  type MyPeopleQuery,
  type PrayerListBurdenFragment,
} from '../generated/graphql'
import { Header } from './Header'
import { STATUS_BY_NAME } from './personStatus'
import styles from './PrayerListPage.module.css'
import { sharedWithShepherds } from './sharing'

type Burden = PrayerListBurdenFragment
type Person = Burden['person']
type Sort = 'standing' | 'newest' | 'person'

// Adding, releasing, undoing or commenting changes the lists, and each person's active burden count and
// latest comment (Home, My people). The Person page refetches on mount, so it needs nothing here.
const RELOAD_PRAYER_LISTS = {
  refetchQueries: [
    { query: ActivePrayerBurdensDocument },
    { query: RecentlyReleasedPrayerBurdensDocument },
    { query: MyPeopleDocument },
  ],
  awaitRefetchQueries: true,
}

const YEAR_MS = 365 * 86_400_000

// Hide details is per device. Storage can throw (private mode), so it falls back to off.
const HIDE_DETAILS_KEY = 'shepherd.prayer.hideDetails'

function readHideDetails(): boolean {
  try {
    return localStorage.getItem(HIDE_DETAILS_KEY) === 'true'
  } catch {
    return false
  }
}

function storeHideDetails(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDE_DETAILS_KEY, 'true')
    else localStorage.removeItem(HIDE_DETAILS_KEY)
  } catch {
    // Ignored, see readHideDetails.
  }
}

const added = (b: Burden) => parseDateTime(b.createdAt).getTime()
const byId = (a: Burden, b: Burden) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const oldestFirst = (a: Burden, b: Burden) => added(a) - added(b) || byId(a, b)
const newestFirst = (a: Burden, b: Burden) => added(b) - added(a) || byId(a, b)
const byName = (a: Person, b: Person) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)

/** The list in display order: one untitled group, or one per person (A→Z) when sorted by person. */
export function sortBurdens(burdens: readonly Burden[], sort: Sort) {
  if (sort !== 'person') {
    return [
      { person: null, burdens: [...burdens].sort(sort === 'newest' ? newestFirst : oldestFirst) },
    ]
  }
  const groups = new Map<string, { person: Person; burdens: Burden[] }>()
  for (const burden of burdens) {
    const group = groups.get(burden.person.id)
    if (group) group.burdens.push(burden)
    else groups.set(burden.person.id, { person: burden.person, burdens: [burden] })
  }
  return [...groups.values()]
    .sort((a, b) => byName(a.person, b.person))
    .map((g) => ({ person: g.person as Person | null, burdens: g.burdens.sort(oldestFirst) }))
}

/** Everyone with an active burden, A→Z, once each. */
function peopleWithBurdens(burdens: readonly Burden[]): Person[] {
  const people = new Map(burdens.map((b) => [b.person.id, b.person]))
  return [...people.values()].sort(byName)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Everything to pray for, across all of the user's people. */
export function PrayerListPage() {
  // Burdens are added and released on person pages too, so don't trust the cache alone.
  const { data, loading, error, refetch } = useActivePrayerBurdensQuery({
    fetchPolicy: 'cache-and-network',
  })
  const { data: people } = useMyPeopleQuery()
  const { data: recent } = useRecentlyReleasedPrayerBurdensQuery({
    fetchPolicy: 'cache-and-network',
  })
  const { data: me } = useMeQuery()
  const [release] = useReleasePrayerBurdenMutation(RELOAD_PRAYER_LISTS)
  const [unrelease] = useUnreleasePrayerBurdenMutation(RELOAD_PRAYER_LISTS)
  const { show, toastElement } = useUndoToast({ floating: true, className: styles.toast })

  const [sort, setSort] = useState<Sort>('standing')
  // Kept as the person, not just the id, so the option stays when their last burden goes.
  const [filter, setFilter] = useState<Person | null>(null)
  // Released here but maybe still in the cached list until the refetch lands.
  const [released, setReleased] = useState<ReadonlySet<string>>(new Set())
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [hideDetails, setHideDetails] = useState(readHideDetails)
  const [adding, setAdding] = useState(false)

  const now = new Date()
  const all = (data?.activePrayerBurdens ?? []).filter((b) => !released.has(b.id))
  const options = peopleWithBurdens(all)
  if (filter && !options.some((p) => p.id === filter.id)) options.push(filter)
  const tints = new Map(options.map((p, i) => [p.id, avatarTint(i)]))
  const shown = filter ? all.filter((b) => b.person.id === filter.id) : all
  const groups = sortBurdens(shown, sort)
  const recentlyReleased = recent?.recentlyReleasedPrayerBurdens ?? []

  const noPeople = people?.myPeople.length === 0
  const summary = filter
    ? plural(shown.length, 'active burden', 'active burdens')
    : `${plural(shown.length, 'active burden', 'active burdens')} across ${plural(
        options.length,
        'person',
        'people',
      )}`

  const onHideDetails = (hidden: boolean) => {
    setHideDetails(hidden)
    storeHideDetails(hidden)
  }

  const setHidden = (id: string, hidden: boolean) =>
    setReleased((ids) => {
      const next = new Set(ids)
      if (hidden) next.add(id)
      else next.delete(id)
      return next
    })

  const onRelease = (burden: Burden) => {
    const first = firstName(burden.person.name)
    setReleaseError(null)
    setHidden(burden.id, true)
    release({ variables: { id: burden.id } }).then(
      () =>
        show(`Released prayer burden for ${first}`, () => {
          unrelease({ variables: { id: burden.id } }).then(
            () => setHidden(burden.id, false),
            (e) => {
              show(`Couldn't undo. ${friendlyMessage(e)}`)
              // Another shepherd changed it; show the list as it now is.
              if (errorCode(e) === 'NOT_FOUND') refetch()
            },
          )
        }),
      (e) => {
        setHidden(burden.id, false)
        setReleaseError(friendlyMessage(e))
      },
    )
  }

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>Prayer list</h1>
            {data && !noPeople && <p className={styles.summary}>{summary}</p>}
          </div>
          {/* mWeb shows it as a floating round "+"; with no people it waits for Add person below. */}
          <Button
            icon={<PlusIcon />}
            className={styles.add}
            disabled={!people || noPeople}
            onClick={() => setAdding(true)}
          >
            <span className={styles.addLabel}>Add prayer burden</span>
          </Button>
        </div>

        {loading && !data && <p className={styles.muted}>Loading…</p>}
        {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
        {releaseError && <Alert variant="inline">{releaseError}</Alert>}

        {data && noPeople && (
          // A new user has no one assigned yet (business rule 1).
          <section className={styles.noPeople}>
            <h2 className={styles.sectionTitle}>No one is assigned to you yet</h2>
            <p className={styles.muted}>
              Add the people you shepherd, then add prayer burdens for them.
            </p>
            <Button as={Link} to="/people/new" icon={<PlusIcon />}>
              Add person
            </Button>
          </section>
        )}

        {data && !noPeople && (
          <>
            <div className={styles.controls}>
              <SegmentedControl
                label="Sort"
                className={styles.sort}
                value={sort}
                onChange={setSort}
                options={[
                  {
                    value: 'standing',
                    // mWeb shortens it to "Longest".
                    label: (
                      <>
                        Longest <span className={styles.long}>standing</span>
                      </>
                    ),
                  },
                  { value: 'newest', label: 'Newest' },
                  { value: 'person', label: 'By person' },
                ]}
              />
              <Select
                label={<span className={styles.filterLabel}>Person</span>}
                aria-label="Filter by person"
                className={styles.filter}
                value={filter?.id ?? ''}
                onChange={(e) => setFilter(options.find((p) => p.id === e.target.value) ?? null)}
              >
                <option value="">Everyone</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Switch checked={hideDetails} onChange={onHideDetails} className={styles.hide}>
                {/* mWeb shows just "Hide"; the full name stays for screen readers. */}
                Hide <span className={styles.longHidden}>details</span>
              </Switch>
            </div>

            <div className={styles.columns}>
              {shown.length === 0 ? (
                // Business rule 3: no one may have burdens yet; or the filtered person has none.
                <p className={styles.empty}>
                  No active prayer burdens here. Add one when something comes up.
                </p>
              ) : (
                <div className={styles.list}>
                  {groups.map(({ person, burdens }) => {
                    const rows = burdens.map((b) => (
                      <BurdenRow
                        key={b.id}
                        burden={b}
                        meId={me?.me.id}
                        tint={tints.get(b.person.id)}
                        now={now}
                        hideDetails={hideDetails}
                        onRelease={onRelease}
                      />
                    ))
                    return person ? (
                      <section
                        key={person.id}
                        aria-labelledby={`group-${person.id}`}
                        className={styles.group}
                      >
                        <h2 id={`group-${person.id}`} className={styles.groupTitle}>
                          {person.name}
                        </h2>
                        {rows}
                      </section>
                    ) : (
                      <div key="all" className={styles.group}>
                        {rows}
                      </div>
                    )
                  })}
                </div>
              )}
              {recentlyReleased.length > 0 && (
                <aside className={styles.aside}>
                  <RecentlyReleased
                    burdens={recentlyReleased}
                    now={now}
                    hideDetails={hideDetails}
                  />
                </aside>
              )}
            </div>
          </>
        )}
      </main>
      {adding && (
        <AddBurdenDialog
          people={people?.myPeople ?? []}
          initialPersonId={filter?.id}
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false)
            show(`Added prayer burden for ${firstName(name)}`)
          }}
        />
      )}
      {toastElement}
    </div>
  )
}

function BurdenRow({
  burden,
  meId,
  tint,
  now,
  hideDetails,
  onRelease,
}: {
  burden: Burden
  meId?: string
  tint?: AvatarTint
  now: Date
  hideDetails: boolean
  onRelease: (burden: Burden) => void
}) {
  const { person, comments } = burden
  const nameId = `burden-${burden.id}-name`
  const threadId = `burden-${burden.id}-thread`
  const [open, setOpen] = useState(false)
  // Newest first, and a burden may have none (business rule 4).
  const latest = comments[0]
  const stale = now.getTime() - added(burden) > YEAR_MS

  return (
    <article aria-labelledby={nameId} className={styles.row}>
      <Avatar name={person.name} tint={tint} className={styles.avatar} />
      <div className={styles.head}>
        <Link id={nameId} to={`/people/${person.id}`} className={styles.name}>
          {person.name}
        </Link>
        <StatusPill
          status={STATUS_BY_NAME[person.status.name] ?? 'active'}
          className={styles.pill}
        />
        <span className={styles.added}>Added {timeAgo(burden.createdAt, now)}</span>
      </div>
      <div className={styles.body}>
        {hideDetails ? (
          <p className={`${styles.content} ${styles.muted}`}>Details hidden</p>
        ) : (
          <p className={styles.content}>{burden.content}</p>
        )}
        {/* The open thread shows it, so it isn't repeated. */}
        {latest && !hideDetails && !open && (
          <p className={styles.comment}>
            <span className={styles.muted}>
              {author(latest, meId)}, {timeAgo(latest.createdAt, now)}:
            </span>{' '}
            {latest.content}
          </p>
        )}
        {stale && (
          <p className={styles.nudge}>
            <ClockIcon className={styles.nudgeIcon} />
            On the list for over a year. Still the right one to carry?
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={threadId}
          onClick={() => setOpen((o) => !o)}
        >
          {/* The name starts with the visible text, so voice control users can say it. */}
          {/* The spaces sit outside the hidden span so the name isn't "Commenton …". */}
          Comment <span className={styles.srOnly}>on prayer burden for {person.name}</span>
          {comments.length > 0 && ` (${comments.length})`}
        </Button>
        <Button
          variant="secondary"
          aria-label={`Release prayer burden for ${person.name}`}
          onClick={() => onRelease(burden)}
        >
          Release
        </Button>
      </div>
      {open && (
        <Thread id={threadId} burden={burden} meId={meId} now={now} hideDetails={hideDetails} />
      )}
    </article>
  )
}

const author = (comment: Burden['comments'][number], meId?: string) =>
  comment.author.id === meId ? 'You' : comment.author.name

/** A burden's comments, oldest first, with the latest two shown until asked for the rest. */
function Thread({
  id,
  burden,
  meId,
  now,
  hideDetails,
}: {
  id: string
  burden: Burden
  meId?: string
  now: Date
  hideDetails: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  const oldestFirst = [...burden.comments].reverse()
  const earlier = Math.max(0, oldestFirst.length - 2)
  const shown = showAll ? oldestFirst : oldestFirst.slice(earlier)

  return (
    <div id={id} className={styles.thread}>
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
            <li key={c.id} className={styles.threadComment}>
              <span aria-hidden="true" className={styles.commentAvatar}>
                {initials(c.author.name)}
              </span>
              <div className={styles.commentBody}>
                <p className={styles.commentMeta}>
                  <span className={styles.commentAuthor}>{author(c, meId)}</span> ·{' '}
                  {timeAgo(c.createdAt, now)}
                </p>
                <p className={hideDetails ? styles.muted : undefined}>
                  {hideDetails ? 'Details hidden' : c.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CommentForm burden={burden} />
    </div>
  )
}

/** Adds a comment linked to the burden; clears itself once it is saved. */
function CommentForm({ burden }: { burden: Burden }) {
  const [content, setContent] = useState('')
  const [createComment, { loading, error }] = useCreateCommentMutation(RELOAD_PRAYER_LISTS)
  const trimmed = content.trim()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || loading) return
    try {
      await createComment({
        variables: {
          input: { personId: burden.person.id, prayerBurdenId: burden.id, content: trimmed },
        },
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
          placeholder="Add a comment on this burden"
          className={styles.commentField}
          help={sharedWithShepherds(burden.person.name)}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <Button type="submit" disabled={!trimmed || loading}>
          Comment
        </Button>
      </div>
      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
    </form>
  )
}

type MyPerson = MyPeopleQuery['myPeople'][number]

/**
 * Adds a burden for one of the user's people, starting on the filtered person (or the only one).
 * The host mounts it only while open, so it starts empty each time.
 */
function AddBurdenDialog({
  people,
  initialPersonId,
  onClose,
  onAdded,
}: {
  people: readonly MyPerson[]
  initialPersonId?: string
  onClose: () => void
  onAdded: (name: string) => void
}) {
  const formId = useId()
  const sorted = [...people].sort(byName)
  const [personId, setPersonId] = useState(
    initialPersonId ?? (sorted.length === 1 ? sorted[0].id : ''),
  )
  const [content, setContent] = useState('')
  const [createPrayerBurden, { loading, error }] =
    useCreatePrayerBurdenMutation(RELOAD_PRAYER_LISTS)
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

/** Released burdens, as encouragement. Read-only: no links or actions. */
function RecentlyReleased({
  burdens,
  now,
  hideDetails,
}: {
  burdens: readonly Burden[]
  now: Date
  hideDetails: boolean
}) {
  return (
    <section aria-labelledby="recently-released" className={styles.released}>
      <h2 id="recently-released" className={styles.releasedTitle}>
        Recently released
      </h2>
      <ul className={styles.releasedList}>
        {burdens.map((b) => {
          // Newest first, and a released burden may have none (business rule 4).
          const latest = b.comments[0]
          return (
            <li key={b.id} className={styles.releasedItem}>
              <p className={styles.releasedMeta}>
                {b.person.name}
                {b.releasedDate && ` · released ${timeAgo(b.releasedDate, now)}`}
              </p>
              {hideDetails ? (
                <p className={`${styles.releasedText} ${styles.muted}`}>Details hidden</p>
              ) : (
                <>
                  <p className={styles.releasedText}>{b.content}</p>
                  {latest && <p className={styles.releasedComment}>{latest.content}</p>}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
