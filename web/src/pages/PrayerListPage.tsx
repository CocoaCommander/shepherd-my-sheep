import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Avatar,
  avatarTint,
  Button,
  ClockIcon,
  PlusIcon,
  SegmentedControl,
  Select,
  StatusPill,
  Switch,
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
  useMeQuery,
  useMyPeopleQuery,
  useRecentlyReleasedPrayerBurdensQuery,
  type PrayerListBurdenFragment,
} from '../generated/graphql'
import { Header } from './Header'
import { STATUS_BY_NAME } from './personStatus'
import styles from './PrayerListPage.module.css'
import {
  AddBurdenDialog,
  BurdenCommentForm,
  commentAuthor,
  Thread,
  useReleaseBurden,
} from './PrayerThread'
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
  const { show, toastElement } = useUndoToast({ floating: true, className: styles.toast })
  const release = useReleaseBurden(show, RELOAD_PRAYER_LISTS)

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
    setReleaseError(null)
    setHidden(burden.id, true)
    release(burden.id, burden.person.name, {
      failed: (message) => {
        setHidden(burden.id, false)
        setReleaseError(message)
      },
      undone: () => setHidden(burden.id, false),
      // Another shepherd changed it; show the list as it now is.
      undoFailed: (e) => {
        if (errorCode(e) === 'NOT_FOUND') refetch()
      },
    })
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
                  { value: 'standing', label: 'Oldest' },
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
                    meId={me?.me.id}
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
          reload={RELOAD_PRAYER_LISTS}
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
              {commentAuthor(latest, meId)}, {timeAgo(latest.createdAt, now)}:
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
        <Thread
          id={threadId}
          className={styles.thread}
          comments={comments}
          meId={meId}
          now={now}
          hideDetails={hideDetails}
        >
          <BurdenCommentForm
            personId={person.id}
            burdenId={burden.id}
            reload={RELOAD_PRAYER_LISTS}
            help={sharedWithShepherds(person.name)}
          />
        </Thread>
      )}
    </article>
  )
}

/** Released burdens, as encouragement. No links or actions; only each burden's comments open. */
function RecentlyReleased({
  burdens,
  meId,
  now,
  hideDetails,
}: {
  burdens: readonly Burden[]
  meId?: string
  now: Date
  hideDetails: boolean
}) {
  return (
    <section aria-labelledby="recently-released" className={styles.released}>
      <h2 id="recently-released" className={styles.releasedTitle}>
        Recently released
      </h2>
      <ul className={styles.releasedList}>
        {burdens.map((b) => (
          <ReleasedItem key={b.id} burden={b} meId={meId} now={now} hideDetails={hideDetails} />
        ))}
      </ul>
    </section>
  )
}

/** One released burden; its comments are collapsed until asked for. */
function ReleasedItem({
  burden,
  meId,
  now,
  hideDetails,
}: {
  burden: Burden
  meId?: string
  now: Date
  hideDetails: boolean
}) {
  const { person, comments } = burden
  const threadId = `released-${burden.id}-thread`
  const [open, setOpen] = useState(false)

  return (
    <li className={styles.releasedItem}>
      <p className={styles.releasedMeta}>
        {person.name}
        {burden.releasedDate && ` · released ${timeAgo(burden.releasedDate, now)}`}
      </p>
      {hideDetails ? (
        <p className={`${styles.releasedText} ${styles.muted}`}>Details hidden</p>
      ) : (
        <p className={styles.releasedText}>{burden.content}</p>
      )}
      {/* A released burden may have no comments (business rule 4): nothing to open. */}
      {comments.length > 0 && (
        <Button
          variant="text"
          className={styles.releasedToggle}
          aria-expanded={open}
          aria-controls={open ? threadId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          {/* The name starts with the visible text, so voice control users can say it. */}
          {open ? 'Hide comments' : `Show comments (${comments.length})`}{' '}
          <span className={styles.srOnly}>on released prayer burden for {person.name}</span>
        </Button>
      )}
      {open && (
        <Thread
          id={threadId}
          className={styles.releasedThread}
          comments={comments}
          meId={meId}
          now={now}
          hideDetails={hideDetails}
        />
      )}
    </li>
  )
}
