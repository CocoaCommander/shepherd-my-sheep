import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  avatarTint,
  BoardColumn,
  Button,
  DueTag,
  MiniPersonCard,
  PlusIcon,
  Select,
  STATUS_LABELS,
  ViewToggle,
  type PersonStatus,
  type ViewMode,
} from '../components'
import { friendlyMessage } from '../errors'
import { timeAgo } from '../format'
import { useMilestonesQuery, useMyPeopleQuery } from '../generated/graphql'
import { NARROW, useMediaQuery } from '../useMediaQuery'
import { useLogContactToast } from './contactToast'
import { Header } from './Header'
import { LogContactDialog } from './LogContactDialog'
import {
  byUrgency,
  contactTag,
  milestoneLabels,
  readView,
  shepherdingCount,
  storeView,
  statusOf,
  STATUS_ORDER,
  STATUS_RULES,
  type Person,
} from './peopleBoard'
import { PeopleGallery } from './PeopleGallery'
import styles from './PeoplePage.module.css'
import { useStatusMove } from './useStatusMove'

/** How a move was asked for; a move from the menu puts focus back on the card's menu. */
type Via = 'menu' | 'drop'

/**
 * My people, as a board or a gallery (remembered per device). The board has a column per
 * status (tabs on mobile web); a card moves by dragging it to another column or with its Move
 * to menu, the keyboard and screen-reader path (WCAG 2.5.7). The gallery is in PeopleGallery.
 */
export function PeoplePage() {
  const narrow = useMediaQuery(NARROW)
  const [view, setView] = useState<ViewMode>(readView)
  const { data, loading, error } = useMyPeopleQuery()
  const { data: milestoneData } = useMilestonesQuery()
  // Who the Log contact dialog is open for (a move from New contact to Active).
  const [logging, setLogging] = useState<Person | null>(null)
  const { show, showLogged, toastElement } = useLogContactToast({
    floating: true,
    className: styles.toast,
  })
  // The card whose menu gets focus back once it has moved (its old one unmounts).
  const [refocus, setRefocus] = useState<{ id: string; to: PersonStatus } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const now = new Date()
  const people = useMemo(() => data?.myPeople ?? [], [data])
  const milestoneNames = useMemo(
    () => new Map((milestoneData?.milestones ?? []).map((m) => [m.id, m.name])),
    [milestoneData],
  )
  const columns = useMemo(() => {
    const byStatus = new Map<PersonStatus, Person[]>(STATUS_ORDER.map((s) => [s, []]))
    for (const p of people) byStatus.get(statusOf(p))!.push(p)
    for (const list of byStatus.values()) list.sort(byUrgency)
    return byStatus
  }, [people])
  // Each person keeps their avatar colour as they move.
  const tints = useMemo(() => new Map(people.map((p, i) => [p.id, avatarTint(i)])), [people])

  useEffect(() => {
    if (!refocus) return
    // Wait for the card to reach its new column (the optimistic update).
    const person = people.find((p) => p.id === refocus.id)
    if (person && statusOf(person) !== refocus.to) return
    const menu = document.querySelector<HTMLSelectElement>(`[data-move-for="${refocus.id}"]`)
    // On mobile the card has left the tab, so focus goes to the tab's panel.
    const target = menu ?? panelRef.current
    if (target) {
      target.focus()
      setRefocus(null)
    }
  }, [refocus, people])

  const { move: moveTo, canMove } = useStatusMove<Person>({
    show,
    narrow,
    onLogContact: setLogging,
  })

  function move(person: Person, to: PersonStatus, via: Via) {
    const sent = moveTo(person, to, () => setRefocus(null))
    if (sent && via === 'menu') setRefocus({ id: person.id, to })
  }

  const card = (person: Person, drag?: (e: DragEvent) => void) => (
    <BoardCard
      key={person.id}
      person={person}
      milestones={milestoneLabels(person.recordedMilestoneIds, milestoneNames)}
      tint={tints.get(person.id)}
      now={now}
      narrow={narrow}
      canMove={canMove}
      onMove={(to) => move(person, to, 'menu')}
      onDragStart={drag}
    />
  )

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <div className={styles.intro}>
          <div>
            <h1 className={styles.title}>My people</h1>
            {data && <p className={styles.subline}>{shepherdingCount(people.length)}</p>}
          </div>
          <div className={styles.headerActions}>
            <Button as={Link} to="/people/new" icon={<PlusIcon />} className={styles.addPerson}>
              Add person
            </Button>
            <ViewToggle
              value={view}
              onChange={(next) => {
                setView(next)
                storeView(next)
              }}
              className={styles.viewToggle}
            />
          </div>
        </div>

        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}

        {data && people.length === 0 && (
          // A new user has no one assigned yet (business rule 1).
          <section className={styles.empty}>
            <h2 className={styles.emptyTitle}>No one is assigned to you yet</h2>
            <p className={styles.muted}>
              Add the people you shepherd and they will show here by status.
            </p>
          </section>
        )}

        {data &&
          (view === 'gallery' ? (
            <PeopleGallery
              people={people}
              milestoneNames={milestoneNames}
              tints={tints}
              now={now}
              narrow={narrow}
            />
          ) : narrow ? (
            <StatusTabs
              columns={columns}
              panelRef={panelRef}
              renderCard={(person) => card(person)}
            />
          ) : (
            <Board columns={columns} people={people} onDrop={(p, to) => move(p, to, 'drop')}>
              {(person, drag) => card(person, drag)}
            </Board>
          ))}
      </main>

      {logging && (
        <LogContactDialog
          person={logging}
          open
          // Cancel leaves the card where it was.
          onClose={() => setLogging(null)}
          onSaved={(saved, wasNewContact) => {
            setLogging(null)
            // Undo is the contact toast's: deleting the contact moves them back (#37).
            showLogged(saved, wasNewContact)
          }}
        />
      )}
      {toastElement}
    </div>
  )
}

/** The wide layout: help line and four columns, cards dragged between them. */
function Board({
  columns,
  people,
  onDrop,
  children,
}: {
  columns: ReadonlyMap<PersonStatus, Person[]>
  people: readonly Person[]
  onDrop: (person: Person, to: PersonStatus) => void
  children: (person: Person, onDragStart: (e: DragEvent) => void) => ReactNode
}) {
  // The card being dragged. Only our cards are accepted, not text or files dragged in.
  const dragging = useRef<string | null>(null)
  const [over, setOver] = useState<PersonStatus | null>(null)

  const endDrag = () => {
    dragging.current = null
    setOver(null)
  }

  return (
    <>
      <p className={styles.help}>
        Drag a card to another column to change someone&apos;s status, or use the Move menu on a
        card. Contact alerts apply to New contact (72 hours) and Active (7 days) only.
      </p>
      <div className={styles.board} onDragEnd={endDrag}>
        {STATUS_ORDER.map((status) => {
          const list = columns.get(status)!
          return (
            <BoardColumn
              key={status}
              status={status}
              count={list.length}
              rule={STATUS_RULES[status]}
              empty="Drop someone here"
              dropActive={over === status}
              onDragOver={(e) => {
                if (!dragging.current) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                if (over !== status) setOver(status)
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setOver((o) => (o === status ? null : o))
              }}
              onDrop={(e) => {
                e.preventDefault()
                const person = people.find((p) => p.id === dragging.current)
                endDrag()
                // A drop on the card's own column does nothing.
                if (person) onDrop(person, status)
              }}
            >
              {list.map((person) =>
                children(person, (e) => {
                  dragging.current = person.id
                  // Firefox starts a drag only with data set.
                  e.dataTransfer?.setData('text/plain', person.id)
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                }),
              )}
            </BoardColumn>
          )
        })}
      </div>
    </>
  )
}

/**
 * The mobile layout: a tab per status (WAI-ARIA tabs, arrow keys move between them), Active
 * first shown, and that status's cards. No dragging; each card has its Move to menu.
 */
function StatusTabs({
  columns,
  panelRef,
  renderCard,
}: {
  columns: ReadonlyMap<PersonStatus, Person[]>
  panelRef: RefObject<HTMLDivElement | null>
  renderCard: (person: Person) => ReactNode
}) {
  const [tab, setTab] = useState<PersonStatus>('active')
  const base = useId()
  const tabId = (s: PersonStatus) => `${base}-tab-${s}`
  const panelId = `${base}-panel`
  const list = columns.get(tab)!

  function onKeyDown(e: KeyboardEvent) {
    const i = STATUS_ORDER.indexOf(tab)
    const last = STATUS_ORDER.length - 1
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % STATUS_ORDER.length
        : e.key === 'ArrowLeft'
          ? (i + last) % STATUS_ORDER.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    const status = STATUS_ORDER[next]
    setTab(status)
    document.getElementById(tabId(status))?.focus()
  }

  return (
    <>
      <div role="tablist" aria-label="Status" className={styles.tabs} onKeyDown={onKeyDown}>
        {STATUS_ORDER.map((status) => {
          const selected = status === tab
          return (
            <button
              key={status}
              type="button"
              role="tab"
              id={tabId(status)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(status)}
            >
              <span>{STATUS_LABELS[status]}</span>{' '}
              <span className={styles.tabCount}>{columns.get(status)!.length}</span>
            </button>
          )
        })}
      </div>
      <div
        ref={panelRef}
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(tab)}
        tabIndex={-1}
        className={styles.panel}
      >
        <p className={styles.rule}>{STATUS_RULES[tab]}</p>
        {list.map(renderCard)}
        {list.length === 0 && (
          <p className={styles.emptyTab}>
            No one here. Move someone into this status from another tab.
          </p>
        )}
      </div>
    </>
  )
}

function BoardCard({
  person,
  milestones,
  tint,
  now,
  narrow,
  canMove,
  onMove,
  onDragStart,
}: {
  person: Person
  milestones: string[]
  tint?: ReturnType<typeof avatarTint>
  now: Date
  narrow: boolean
  canMove: boolean
  onMove: (to: PersonStatus) => void
  onDragStart?: (e: DragEvent) => void
}) {
  const status = statusOf(person)
  const tag = contactTag(person, now)
  const when = person.lastContactedAt ? timeAgo(person.lastContactedAt, now) : undefined
  const draggable = !narrow && !!onDragStart

  return (
    <MiniPersonCard
      name={person.name}
      renderName={(name) => <Link to={`/people/${person.id}`}>{name}</Link>}
      // On mobile there's no column title above, so the card names its tab's people at h2.
      headingLevel={narrow ? 2 : 3}
      lastContact={when && narrow ? `Last contact: ${when}` : when}
      prayerCount={person.activeBurdenCount}
      milestones={milestones}
      avatarTint={tint}
      className={narrow ? styles.narrowCard : undefined}
      tag={<DueTag tone={tag.tone}>{tag.label}</DueTag>}
      actions={
        <Select
          aria-label={`Move ${person.name} to another status`}
          data-move-for={person.id}
          value=""
          disabled={!canMove}
          className={styles.move}
          onChange={(e) => {
            if (e.target.value) onMove(e.target.value as PersonStatus)
          }}
        >
          <option value="">Move to</option>
          {STATUS_ORDER.filter((s) => s !== status).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      }
      grip={draggable}
      draggable={draggable || undefined}
      onDragStart={draggable ? onDragStart : undefined}
    />
  )
}
