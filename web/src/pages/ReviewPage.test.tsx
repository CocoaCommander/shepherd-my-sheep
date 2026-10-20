import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { ReviewPage } from './ReviewPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A Thursday afternoon, local time.
const NOW = new Date(2026, 9, 15, 14, 0, 0)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const ACTIVE = { __typename: 'Status', id: 'st-active', name: 'active' }
const NEW = { __typename: 'Status', id: 'st-new', name: 'new contact' }
const ME = { __typename: 'User', id: 'u-me', name: 'Daniel Okafor', username: 'daniel' }
const MENTOR = { __typename: 'User', id: 'u-2', name: 'Grace Lim' }
const MENTOR2 = { __typename: 'User', id: 'u-3', name: 'Paul Reyes' }
const ME_SHEPHERD = { __typename: 'User', id: ME.id, name: ME.name }

type Person = Record<string, unknown> & { id: string; name: string }

function person(id: string, name: string, overrides: Record<string, unknown> = {}): Person {
  return {
    __typename: 'Person',
    id,
    name,
    age: null,
    yearMet: null,
    lastContactedAt: null,
    contactDueAt: null,
    contactClockStart: null,
    contactState: G.ContactState.NotTracked,
    isActive: true,
    status: ACTIVE,
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds: [],
    createdAt: at(-90 * DAY),
    ...overrides,
  }
}

function active(id: string, name: string, daysAgo: number, overrides = {}) {
  const due = (7 - daysAgo) * DAY
  return person(id, name, {
    lastContactedAt: at(-daysAgo * DAY),
    contactDueAt: at(due),
    contactClockStart: at(-daysAgo * DAY),
    contactState: due < 0 ? G.ContactState.Overdue : G.ContactState.DueSoon,
    ...overrides,
  })
}

const ELENA = active('p-elena', 'Elena Petrova', 21, {
  age: 34,
  yearMet: 2024,
  shepherds: [ME_SHEPHERD, MENTOR, MENTOR2],
})
const JAMES = active('p-james', 'James Whitfield', 10, { yearMet: 2023, shepherds: [ME_SHEPHERD] })
const RUTH = active('p-ruth', 'Ruth Adeyemi', 9)
const AISHA = active('p-aisha', 'Aisha Bello', 6)
const TOM = person('p-tom', 'Tom Becker', {
  status: NEW,
  createdAt: at(-5 * DAY),
  contactDueAt: at(-2 * DAY),
  contactClockStart: at(-5 * DAY),
  contactState: G.ContactState.Overdue,
})

function detail(p: Person, overrides: Record<string, unknown> = {}) {
  return { ...p, milestones: [], prayerBurdens: [], comments: [], contacts: [], ...overrides }
}

function burden(
  id: string,
  content: string,
  createdAt: string,
  releasedDate: string | null = null,
) {
  return { __typename: 'PrayerBurden', id, content, releasedDate, createdAt }
}

function milestone(name: string) {
  return {
    __typename: 'MilestonePerson',
    id: `mp-${name}`,
    dateAchieved: '2026-01-02',
    notes: null,
    milestone: { __typename: 'Milestone', id: `m-${name}`, name },
    recordedBy: ME_SHEPHERD,
  }
}

function note(content: string, createdAt: string) {
  return {
    __typename: 'Comment',
    id: 'c-last',
    content,
    createdAt,
    author: ME_SHEPHERD,
    prayerBurden: null,
  }
}

/** Answers each call with the next response; the last one repeats. */
function sequence(responses: unknown[]) {
  let i = 0
  return vi.fn(() => responses[Math.min(i++, responses.length - 1)] as { data: object })
}

interface Setup {
  /** What ContactAlerts returns on the first load, then after each refetch. */
  alerts: Person[][]
  details?: Record<string, unknown>
  mocks?: MockedResponse[]
}

function renderReview({ alerts, details = {}, mocks = [] }: Setup) {
  const personMocks: MockedResponse[] = alerts.flat().map((p) => ({
    request: { query: G.PersonDocument, variables: { id: p.id } },
    result: { data: { person: details[p.id] ?? detail(p) } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  }))
  const alertsResult = sequence(alerts.map((a) => ({ data: { contactAlerts: a } })))
  const list: MockedResponse[] = [
    {
      request: { query: G.ContactAlertsDocument },
      result: alertsResult,
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: G.MyPeopleDocument },
      result: { data: { myPeople: [] } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: G.MeDocument },
      result: { data: { me: ME } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ]
  const utils = render(
    <MockedProvider mocks={[...mocks, ...list, ...personMocks]}>
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/" element={<p>Home route</p>} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return { ...utils, alertsResult }
}

/** What LogContact returns: the person, no longer overdue. */
function loggedPerson(p: Person) {
  return detail(
    {
      ...p,
      lastContactedAt: at(0),
      contactDueAt: at(7 * DAY),
      contactClockStart: at(0),
      contactState: G.ContactState.OnTrack,
      status: ACTIVE,
    },
    {
      contacts: [
        {
          __typename: 'ContactLog',
          id: 'c-new',
          contactedAt: at(0),
          isFollowUp: false,
          createdAt: at(0),
        },
      ],
    },
  )
}

function logMock(p: Person, input: Partial<G.LogContactInput>) {
  const result = vi.fn(() => ({ data: { logContact: loggedPerson(p) } }))
  const mock: MockedResponse = {
    request: {
      query: G.LogContactDocument,
      variables: {
        input: { personId: p.id, contactedAt: NOW.toISOString(), note: 'Coffee', ...input },
      },
    },
    result,
  }
  return { result, mock }
}

const commentInput = () => screen.getByLabelText('Comment (required)')
const logButton = () => screen.getByRole('button', { name: 'Log contact' })
const skipButton = () => screen.getByRole('button', { name: 'Skip for now' })
const queueOf = () => {
  const heading = screen.getByRole('heading', { name: 'Review queue' })
  return (heading.closest('aside') ?? heading.parentElement) as HTMLElement
}
const step = (name: string) => screen.findByRole('heading', { level: 2, name })

async function logCurrent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(commentInput(), 'Coffee')
  await user.click(logButton())
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('ReviewPage', () => {
  it('shows Loading… first', () => {
    renderReview({ alerts: [[ELENA]] })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it.each([
    ['a user with no people', []],
    ['nobody overdue, only due soon', [AISHA]],
  ])('says no one is overdue for %s', async (_name, alerts) => {
    renderReview({ alerts: [alerts] })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No one is overdue' }),
    ).toBeVisible()
    expect(screen.getByText("There's no one to review right now.")).toBeInTheDocument()
    // The header has one too.
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Back to Home' }),
    ).toHaveAttribute('href', '/')
  })

  it('reviews only overdue people, in the order the server gave', async () => {
    renderReview({ alerts: [[JAMES, AISHA, ELENA, TOM]] })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Review overdue contacts' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Most urgent first. Log each contact as you go.')).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'James Whitfield' })).toBeInTheDocument()
    const items = within(queueOf()).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('James Whitfield'),
      expect.stringContaining('Elena Petrova'),
      expect.stringContaining('Tom Becker'),
    ])
    expect(queueOf()).not.toHaveTextContent('Aisha Bello')
    expect(queueOf()).toHaveTextContent('3 overdue')
    expect(screen.getByRole('link', { name: 'Exit review' })).toHaveAttribute('href', '/')
  })

  it('shows the person card, meter and shared line', async () => {
    renderReview({ alerts: [[ELENA, JAMES]] })
    await step('Elena Petrova')
    expect(screen.getByText('34 · met 2024')).toBeInTheDocument()
    // Also in the queue aside.
    const card = screen.getByRole('article', { name: 'Elena Petrova' })
    expect(within(card).getByText('14 days overdue')).toBeInTheDocument()
    expect(screen.getByText('Shared with Grace Lim, Paul Reyes')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: '21 days since last contact. Goal: every 7 days' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Step 1 of 2' })).toBeInTheDocument()
    expect(
      screen.getByText('Skipping logs nothing. Elena stays overdue on Home.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Open Elena's page" })).toHaveAttribute(
      'href',
      '/people/p-elena',
    )
    expect(screen.getByRole('heading', { name: 'Log contact' })).toBeInTheDocument()
  })

  it('says "Just you" and "Met {year}" when unshared and without an age', async () => {
    renderReview({ alerts: [[JAMES]] })
    expect(await screen.findByText('Just you')).toBeInTheDocument()
    expect(screen.getByText('Met 2023')).toBeInTheDocument()
  })

  it('shows the latest note, newest active burden and recorded milestones', async () => {
    renderReview({
      alerts: [[ELENA]],
      details: {
        'p-elena': detail(
          { ...ELENA, latestComment: note('Talked about her job', at(-21 * DAY)) },
          {
            milestones: [milestone('baptised'), milestone('leading')],
            prayerBurdens: [
              burden('b1', 'Old worry', at(-30 * DAY)),
              burden('b2', 'Her mother is ill', at(-3 * DAY)),
              burden('b3', 'Released one', at(-1 * DAY), '2026-10-14'),
            ],
          },
        ),
      },
    })
    expect(await screen.findByText('Last note, 3 weeks ago')).toBeInTheDocument()
    expect(screen.getByText('Talked about her job')).toBeInTheDocument()
    expect(screen.getByText('Her mother is ill')).toBeInTheDocument()
    expect(screen.queryByText('Released one')).not.toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
    for (const t of ['Baptised', 'Joined small group', 'Serving', 'Leading'])
      expect(screen.getByText(t)).toBeInTheDocument()
    expect(screen.queryByText('None recorded yet.')).not.toBeInTheDocument()
  })

  it('handles zero notes, burdens and milestones', async () => {
    renderReview({ alerts: [[JAMES]] })
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument()
    expect(screen.getByText('No active prayer burdens yet.')).toBeInTheDocument()
    expect(screen.getByText('Milestones')).toBeInTheDocument()
    expect(screen.getByText('None recorded yet.')).toBeInTheDocument()
    expect(screen.queryByText('Baptised')).not.toBeInTheDocument()
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })

  it('words a new contact with the follow-up copy and steps panel', async () => {
    renderReview({ alerts: [[TOM]] })
    await step('Tom Becker')
    expect(screen.getByText('What happens next')).toBeInTheDocument()
    for (const t of ['Added as a New contact', 'Log a contact', 'Becomes Active'])
      expect(screen.getByText(t)).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Added 5 days ago, no contact logged. Follow up within 72 hours',
      }),
    ).toBeInTheDocument()
  })

  it('does not show the steps panel for an active person', async () => {
    renderReview({ alerts: [[JAMES]] })
    await step('James Whitfield')
    expect(screen.queryByText('What happens next')).not.toBeInTheDocument()
  })

  it('logs a contact, sends it, and moves to the next person', async () => {
    const { mock, result } = logMock(ELENA, { prayerBurden: 'Her job' })
    renderReview({ alerts: [[ELENA, JAMES], [JAMES]], mocks: [mock] })
    const user = userEvent.setup()
    await step('Elena Petrova')
    await user.type(commentInput(), 'Coffee')
    await user.type(screen.getByLabelText('Prayer burden (optional)'), 'Her job')
    await user.click(logButton())

    const next = await step('James Whitfield')
    expect(result).toHaveBeenCalledTimes(1)
    expect(next).toHaveFocus()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Step 2 of 2. 1 logged, 0 skipped.' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // Last step copy.
    expect(screen.getByText('Last one. 1 logged, 0 skipped so far.')).toBeInTheDocument()
    expect(screen.getByText('This is the last person. A summary comes next.')).toBeInTheDocument()
  })

  it('keeps the queue and counter after the refetch drops the logged person', async () => {
    const { mock } = logMock(ELENA, {})
    const { alertsResult } = renderReview({
      alerts: [
        [ELENA, JAMES, RUTH],
        [JAMES, RUTH],
      ],
      mocks: [mock],
    })
    const user = userEvent.setup()
    await step('Elena Petrova')
    await logCurrent(user)
    await step('James Whitfield')
    await waitFor(() => expect(alertsResult.mock.calls.length).toBeGreaterThan(1))

    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    const items = within(queueOf()).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Elena Petrova')
    expect(items[0]).toHaveTextContent('Logged')
    expect(items[0]).toHaveTextContent('Contact logged')
    expect(items[1]).toHaveTextContent('Now')
    expect(items[2]).toHaveTextContent('To do')
    expect(screen.getByText(/Up next:.*Ruth Adeyemi/)).toBeInTheDocument()
  })

  it('skips without sending anything and marks the person Skipped', async () => {
    const { mock, result } = logMock(ELENA, {})
    renderReview({ alerts: [[ELENA, JAMES]], mocks: [mock] })
    const user = userEvent.setup()
    await step('Elena Petrova')
    await user.click(skipButton())

    await step('James Whitfield')
    expect(result).not.toHaveBeenCalled()
    expect(
      screen.getByRole('img', { name: 'Step 2 of 2. 0 logged, 1 skipped.' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Last one. 0 logged, 1 skipped so far.')).toBeInTheDocument()
    const first = within(queueOf()).getAllByRole('listitem')[0]
    expect(first).toHaveTextContent('Skipped')
    expect(first).toHaveTextContent('14 days overdue')
  })

  it('uses the last-step help line for a single person, without the "Last one" subline', async () => {
    renderReview({ alerts: [[ELENA]] })
    await step('Elena Petrova')
    expect(screen.getByText('This is the last person. A summary comes next.')).toBeInTheDocument()
    expect(screen.getByText('Most urgent first. Log each contact as you go.')).toBeInTheDocument()
    expect(screen.queryByText(/Last one\./)).not.toBeInTheDocument()
  })

  it('finishes with the counts and how many are still overdue on Home', async () => {
    const { mock } = logMock(ELENA, {})
    // Only the log refetches; Skip sends nothing.
    renderReview({ alerts: [[ELENA, JAMES], [JAMES]], mocks: [mock] })
    const user = userEvent.setup()
    await step('Elena Petrova')
    await logCurrent(user)
    await step('James Whitfield')
    await user.click(skipButton())

    expect(await screen.findByRole('heading', { level: 1, name: 'Review finished' })).toBeVisible()
    expect(screen.getByText(/1 of 2 contacts logged\./)).toBeInTheDocument()
    expect(screen.getByText(/1 is still overdue\./)).toBeInTheDocument()
    expect(await screen.findByText('Home now shows 1 person overdue.')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Back to Home' })
    expect(links.length).toBeGreaterThan(0)
    for (const l of links) expect(l).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: 'Exit review' })).not.toBeInTheDocument()
  })

  it('says no one is overdue on Home once everyone is logged', async () => {
    const { mock } = logMock(ELENA, {})
    renderReview({ alerts: [[ELENA], []], mocks: [mock] })
    const user = userEvent.setup()
    await step('Elena Petrova')
    await logCurrent(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Review finished' })).toBeVisible()
    expect(screen.getByText(/1 of 1 contact logged\./)).toBeInTheDocument()
    expect(screen.queryByText(/still overdue/)).not.toBeInTheDocument()
    expect(await screen.findByText('Home now shows no one overdue.')).toBeInTheDocument()
  })

  it('counts several skipped people as "are still overdue"', async () => {
    renderReview({ alerts: [[ELENA, JAMES]] })
    const user = userEvent.setup()
    await step('Elena Petrova')
    await user.click(skipButton())
    await step('James Whitfield')
    await user.click(skipButton())
    expect(await screen.findByText(/0 of 2 contacts logged\./)).toBeInTheDocument()
    expect(screen.getByText(/2 are still overdue\./)).toBeInTheDocument()
    expect(await screen.findByText('Home now shows 2 people overdue.')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = renderReview({ alerts: [[ELENA, TOM]] })
    await step('Elena Petrova')
    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    })
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([])
  })
})
