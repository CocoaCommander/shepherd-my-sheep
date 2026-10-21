import { describe, expect, it } from 'vitest'
import { ContactState } from '../generated/graphql'
import {
  byUrgency,
  contactTag,
  milestoneLabels,
  movedMessage,
  shepherdingCount,
  type Person,
} from './peopleBoard'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date(2026, 9, 15, 14, 0, 0)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const ACTIVE = { id: 'st-active', name: 'active' }
const NEW = { id: 'st-new', name: 'new contact' }

function p(name: string, contactDueAt: string | null) {
  return { name, contactDueAt } as Person
}

describe('byUrgency', () => {
  it('puts the most overdue first', () => {
    const list = [p('A', at(2 * DAY)), p('B', at(-3 * DAY)), p('C', at(-1 * DAY))]
    expect(list.sort(byUrgency).map((x) => x.name)).toEqual(['B', 'C', 'A'])
  })

  it('sorts people with no due time (not tracked) by name, after tracked people', () => {
    const list = [p('Zed', null), p('Amy', null), p('Mia', at(DAY))]
    expect(list.sort(byUrgency).map((x) => x.name)).toEqual(['Mia', 'Amy', 'Zed'])
  })

  it('breaks ties by name', () => {
    const due = at(DAY)
    const list = [p('Zed', due), p('Amy', due)]
    expect(list.sort(byUrgency).map((x) => x.name)).toEqual(['Amy', 'Zed'])
  })
})

describe('contactTag', () => {
  const tag = (status: typeof ACTIVE, contactState: ContactState, due: string | null) =>
    contactTag({ status, contactState, contactDueAt: due }, NOW)

  it('counts days overdue for an active person', () => {
    expect(tag(ACTIVE, ContactState.Overdue, at(-3 * DAY))).toEqual({
      tone: 'overdue',
      label: '3 days overdue',
    })
  })

  it('says follow-up overdue for a new contact', () => {
    expect(tag(NEW, ContactState.Overdue, at(-6 * HOUR))).toEqual({
      tone: 'overdue',
      label: 'Follow-up overdue',
    })
  })

  it('says due today or due in n days when due soon', () => {
    expect(tag(ACTIVE, ContactState.DueSoon, at(2 * HOUR)).label).toBe('Due today')
    expect(tag(ACTIVE, ContactState.DueSoon, at(2 * DAY))).toEqual({
      tone: 'soon',
      label: 'Due in 2 days',
    })
  })

  it('counts hours left for a new contact', () => {
    expect(tag(NEW, ContactState.DueSoon, at(5 * HOUR + 10 * 60_000))).toEqual({
      tone: 'soon',
      label: '5 hours left',
    })
  })

  it('is on track', () => {
    expect(tag(ACTIVE, ContactState.OnTrack, at(5 * DAY))).toEqual({
      tone: 'ok',
      label: 'On track',
    })
  })

  it('is on track while tracked but with no due time yet', () => {
    expect(tag(ACTIVE, ContactState.OnTrack, null)).toEqual({ tone: 'ok', label: 'On track' })
  })

  it('is not tracked for inactive and lost contact people', () => {
    expect(tag({ id: 'x', name: 'inactive' }, ContactState.NotTracked, null)).toEqual({
      tone: 'none',
      label: 'Not tracked',
    })
  })
})

describe('milestoneLabels', () => {
  const names = new Map([
    ['m1', 'baptised'],
    ['m2', 'joined small group'],
    ['m3', 'serving'],
    ['m4', 'leading'],
    ['m5', 'something else'],
  ])

  it('maps ids to the bar labels', () => {
    expect(milestoneLabels(['m1', 'm2', 'm3', 'm4'], names)).toEqual([
      'Baptised',
      'Small group',
      'Serving',
      'Leading',
    ])
  })

  it('drops unknown ids and names', () => {
    expect(milestoneLabels(['m1', 'm5', 'nope'], names)).toEqual(['Baptised'])
  })

  it('is empty for no milestones (business rule 2) or before they load', () => {
    expect(milestoneLabels([], names)).toEqual([])
    expect(milestoneLabels(['m1'], new Map())).toEqual([])
  })
})

describe('movedMessage', () => {
  it('is short for a tracked status', () => {
    expect(movedMessage('Elena Petrova', 'active', false)).toBe('Moved Elena Petrova to Active.')
    expect(movedMessage('Elena Petrova', 'new', true)).toBe('Moved Elena Petrova to New contact.')
  })

  it('says the person is no longer tracked for an untracked status', () => {
    expect(movedMessage('Elena Petrova', 'inactive', false)).toBe(
      'Moved Elena Petrova to Inactive. No longer tracked for contact alerts.',
    )
    expect(movedMessage('Elena Petrova', 'lost', false)).toBe(
      'Moved Elena Petrova to Lost contact. No longer tracked for contact alerts.',
    )
  })

  it('drops "contact" on narrow screens', () => {
    expect(movedMessage('Elena Petrova', 'inactive', true)).toBe(
      'Moved Elena Petrova to Inactive. No longer tracked for alerts.',
    )
  })
})

describe('shepherdingCount', () => {
  it('pluralises', () => {
    expect(shepherdingCount(0)).toBe('0 people you are shepherding')
    expect(shepherdingCount(1)).toBe('1 person you are shepherding')
    expect(shepherdingCount(9)).toBe('9 people you are shepherding')
  })
})
