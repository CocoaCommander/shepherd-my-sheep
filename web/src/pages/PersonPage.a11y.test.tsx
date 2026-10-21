import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { PersonPage } from './PersonPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date(2026, 9, 14, 9, 41, 7)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }

function person(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id: 'person-1',
    name: 'Maria Santos',
    age: 34,
    yearMet: 2020,
    lastContactedAt: at(-2 * DAY),
    contactDueAt: at(5 * DAY),
    contactClockStart: at(-2 * DAY),
    statusChangedAt: null,
    contactState: G.ContactState.OnTrack,
    createdAt: at(-60 * DAY),
    isActive: true,
    status: { __typename: 'Status', id: 'st-active', name: 'active' },
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds: [{ __typename: 'User', id: ME.id, name: ME.name }],
    milestones: [],
    prayerBurdens: [],
    comments: [],
    contacts: [],
    ...overrides,
  }
}

const TYPES = [
  ['ms-baptised', 'baptised'],
  ['ms-group', 'joined small group'],
  ['ms-serving', 'serving'],
  ['ms-leading', 'leading'],
].map(([id, name]) => ({ __typename: 'Milestone', id, name, description: name }))

async function violations(p: object) {
  const mocks: MockedResponse[] = [
    {
      request: { query: G.PersonDocument, variables: { id: 'person-1' } },
      result: { data: { person: p } },
    },
    ...[
      { request: { query: G.MeDocument }, result: { data: { me: ME } } },
      { request: { query: G.MilestonesDocument }, result: { data: { milestones: TYPES } } },
    ].map((m) => ({ ...m, maxUsageCount: Number.POSITIVE_INFINITY })),
  ]
  const { container } = render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={['/people/person-1']}>
        <Routes>
          <Route path="/people/:id" element={<PersonPage />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  await screen.findByRole('button', { name: 'Log contact' })
  const results = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('Person page accessibility (axe-core, WCAG 2.2 A/AA)', () => {
  it('active and on track', async () => {
    expect(await violations(person())).toEqual([])
  })

  it('overdue', async () => {
    expect(
      await violations(
        person({ contactState: G.ContactState.Overdue, contactDueAt: at(-3 * DAY) }),
      ),
    ).toEqual([])
  })

  it('with some milestones recorded and some not', async () => {
    const milestones = [
      { id: 'mp1', type: TYPES[0], dateAchieved: '2021-10-14', notes: 'At the lake' },
      { id: 'mp2', type: TYPES[3], dateAchieved: null, notes: null },
    ].map((m) => ({
      __typename: 'MilestonePerson',
      id: m.id,
      dateAchieved: m.dateAchieved,
      notes: m.notes,
      milestone: { __typename: 'Milestone', id: m.type.id, name: m.type.name },
      recordedBy: { __typename: 'User', id: ME.id, name: ME.name },
    }))
    expect(await violations(person({ milestones }))).toEqual([])
  })

  it('with a burden thread, a released burden and notes', async () => {
    const author = { __typename: 'User', id: ME.id, name: ME.name }
    const other = { __typename: 'User', id: 'user-other', name: 'Other Shepherd' }
    const burden = (id: string, content: string, releasedDate: string | null) => ({
      __typename: 'PrayerBurden',
      id,
      content,
      releasedDate,
      createdAt: at(-5 * DAY),
    })
    const comment = (id: string, content: string, burdenId: string | null, who = author) => ({
      __typename: 'Comment',
      id,
      content,
      createdAt: at(-DAY),
      author: who,
      prayerBurden: burdenId ? { __typename: 'PrayerBurden', id: burdenId } : null,
      contactLogId: null,
    })
    expect(
      await violations(
        person({
          prayerBurdens: [burden('b1', 'Pray for work', null), burden('b2', 'Old', '2026-10-01')],
          comments: [
            { ...comment('n2', 'Coffee after church', null, other), contactLogId: 'c-old' },
            comment('n1', 'Plain note', null),
            comment('c3', 'Third', 'b1'),
            comment('c2', 'Second', 'b1', other),
            comment('c1', 'First', 'b1'),
            comment('c0', 'It was answered', 'b2', other),
          ],
          contacts: [
            {
              __typename: 'ContactLog',
              id: 'c-old',
              contactedAt: at(-2 * DAY),
              contactedBy: author,
            },
          ],
        }),
      ),
    ).toEqual([])
  })
})
