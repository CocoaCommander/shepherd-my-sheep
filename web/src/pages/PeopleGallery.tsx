import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AddPersonTile,
  Chip,
  DueTag,
  PersonCard,
  SearchInput,
  STATUS_LABELS,
  type AvatarTint,
  type PersonStatus,
} from '../components'
import { timeAgo } from '../format'
import {
  byName,
  contactTag,
  matchesName,
  milestoneLabels,
  personSubtitle,
  statusOf,
  STATUS_ORDER,
  type Person,
} from './peopleBoard'
import styles from './PeoplePage.module.css'

type Filter = PersonStatus | 'all'

/**
 * My people as a gallery: search by name, a status filter, and a card per person by name,
 * ending with Add someone new. On mobile web, 2-up compact cards (Add person is in the header).
 */
export function PeopleGallery({
  people,
  milestoneNames,
  tints,
  now,
  narrow,
}: {
  people: readonly Person[]
  milestoneNames: ReadonlyMap<string, string>
  tints: ReadonlyMap<string, AvatarTint>
  now: Date
  narrow: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  // Chip counts are the whole status, whatever the search.
  const count = (status: PersonStatus) => people.filter((p) => statusOf(p) === status).length
  const shown = people
    .filter((p) => (filter === 'all' || statusOf(p) === filter) && matchesName(p, query))
    .sort(byName)

  const chip = (value: Filter, label: string, n: number) => (
    <Chip key={value} pressed={filter === value} count={n} onClick={() => setFilter(value)}>
      {label}
    </Chip>
  )

  return (
    <>
      <div className={styles.filters}>
        <SearchInput
          label="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.search}
        />
        <div role="group" aria-label="Filter by status" className={styles.chips}>
          {chip('all', 'All', people.length)}
          {STATUS_ORDER.map((s) => chip(s, STATUS_LABELS[s], count(s)))}
        </div>
      </div>

      {people.length > 0 && shown.length === 0 && (
        <p className={styles.noMatch}>{noMatch(query, filter)}</p>
      )}

      <div className={narrow ? styles.galleryNarrow : styles.gallery}>
        {shown.map((person) => {
          const tag = contactTag(person, now)
          return (
            <PersonCard
              key={person.id}
              name={person.name}
              renderName={(name) => <Link to={`/people/${person.id}`}>{name}</Link>}
              headingLevel={2}
              subtitle={personSubtitle(person)}
              status={statusOf(person)}
              tag={<DueTag tone={tag.tone}>{tag.label}</DueTag>}
              lastContact={
                person.lastContactedAt ? timeAgo(person.lastContactedAt, now) : undefined
              }
              milestones={milestoneLabels(person.recordedMilestoneIds, milestoneNames)}
              prayerCount={person.activeBurdenCount}
              compact={narrow}
              avatarTint={tints.get(person.id)}
            />
          )
        })}
        {!narrow && <AddPersonTile as={Link} to="/people/new" />}
      </div>
    </>
  )
}

/** 'No one matches "Mar".', 'No one in Lost contact matches "Mar".', "No one in Lost contact." */
function noMatch(query: string, filter: Filter): string {
  const q = query.trim()
  const where = filter === 'all' ? '' : ` in ${STATUS_LABELS[filter]}`
  return q ? `No one${where} matches "${q}".` : `No one${where}.`
}
