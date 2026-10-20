import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Avatar,
  avatarTint,
  Button,
  PlusIcon,
  SegmentedControl,
  Select,
  StatusPill,
  useUndoToast,
  type AvatarTint,
} from '../components'
import { errorCode, friendlyMessage } from '../errors'
import { firstName, parseDateTime, timeAgo } from '../format'
import {
  ActivePrayerBurdensDocument,
  MyPeopleDocument,
  useActivePrayerBurdensQuery,
  useMeQuery,
  useMyPeopleQuery,
  useReleasePrayerBurdenMutation,
  useUnreleasePrayerBurdenMutation,
  type PrayerListBurdenFragment,
} from '../generated/graphql'
import { Header } from './Header'
import { STATUS_BY_NAME } from './personStatus'
import styles from './PrayerListPage.module.css'

type Burden = PrayerListBurdenFragment
type Person = Burden['person']
type Sort = 'standing' | 'newest' | 'person'

// Releasing or undoing changes the list and each person's active burden count (Home, My people).
// The Person page refetches on mount, so it needs nothing here.
const RELOAD_PRAYER_LISTS = {
  refetchQueries: [{ query: ActivePrayerBurdensDocument }, { query: MyPeopleDocument }],
  awaitRefetchQueries: true,
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

  const now = new Date()
  const all = (data?.activePrayerBurdens ?? []).filter((b) => !released.has(b.id))
  const options = peopleWithBurdens(all)
  if (filter && !options.some((p) => p.id === filter.id)) options.push(filter)
  const tints = new Map(options.map((p, i) => [p.id, avatarTint(i)]))
  const shown = filter ? all.filter((b) => b.person.id === filter.id) : all
  const groups = sortBurdens(shown, sort)

  const noPeople = people?.myPeople.length === 0
  const summary = filter
    ? plural(shown.length, 'active burden', 'active burdens')
    : `${plural(shown.length, 'active burden', 'active burdens')} across ${plural(
        options.length,
        'person',
        'people',
      )}`

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
        <div>
          <h1 className={styles.title}>Prayer list</h1>
          {data && !noPeople && <p className={styles.summary}>{summary}</p>}
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
            </div>

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
          </>
        )}
      </main>
      {toastElement}
    </div>
  )
}

function BurdenRow({
  burden,
  meId,
  tint,
  now,
  onRelease,
}: {
  burden: Burden
  meId?: string
  tint?: AvatarTint
  now: Date
  onRelease: (burden: Burden) => void
}) {
  const { person, comments } = burden
  const profile = `/people/${person.id}`
  const nameId = `burden-${burden.id}-name`
  // Newest first, and a burden may have none (business rule 4).
  const latest = comments[0]

  return (
    <article aria-labelledby={nameId} className={styles.row}>
      <Avatar name={person.name} tint={tint} className={styles.avatar} />
      <div className={styles.head}>
        <Link id={nameId} to={profile} className={styles.name}>
          {person.name}
        </Link>
        <StatusPill
          status={STATUS_BY_NAME[person.status.name] ?? 'active'}
          className={styles.pill}
        />
        <span className={styles.added}>Added {timeAgo(burden.createdAt, now)}</span>
      </div>
      <div className={styles.body}>
        <p className={styles.content}>{burden.content}</p>
        {latest && (
          <p className={styles.comment}>
            <span className={styles.muted}>
              {latest.author.id === meId ? 'You' : latest.author.name},{' '}
              {timeAgo(latest.createdAt, now)}:
            </span>{' '}
            {latest.content}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        {/* Opens the thread inline in a later step; until then, the person page has it. */}
        <Button as={Link} to={profile} variant="secondary">
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
    </article>
  )
}
