import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatShortDate, timeAgo } from '../format'
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
    statusChangedAt: null,
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
    statusChangedAt: null,
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
  statusChangedAt: null,
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
      statusChangedAt: null,
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

/** Waits for the person to load, since the form only shows once they are known to be overdue. */
async function skip(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
}

async function logCurrent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Comment (required)'), 'Coffee')
  await user.click(logButton())
}

function deleteMock(p: Person, result?: Record<string, unknown>) {
  const fn = vi.fn(() => result ?? { data: { deleteContact: detail(p) } })
  const mock: MockedResponse = {
    request: { query: G.DeleteContactDocument, variables: { id: 'c-new' } },
    result: fn,
  }
  return { result: fn, mock }
}

const notFound = () => ({
  errors: [new GraphQLError('gone', { extensions: { code: 'NOT_FOUND' } })],
})

function personMock(id: string, result: Record<string, unknown>): MockedResponse {
  return {
    request: { query: G.PersonDocument, variables: { id } },
    result,
    maxUsageCount: Number.POSITIVE_INFINITY,
  }
}

const finishedHeading = () => screen.findByRole('heading', { level: 1, name: 'Review finished' })
const rowOf = (button: HTMLElement) => button.closest('li') as HTMLElement
const undoRow = (name: string) =>
  rowOf(screen.getByRole('button', { name: `Undo contact logged for ${name}` }))
const cardOf = (name: RegExp) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement
const overdueRows = () => screen.queryAllByRole('button', { name: /review again/i }).map(rowOf)

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
    await user.type(await screen.findByLabelText('Comment (required)'), 'Coffee')
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
    expect(
      await screen.findByText('This is the last person. A summary comes next.'),
    ).toBeInTheDocument()
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
    await skip(user)

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
    await skip(user)

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
    await skip(user)
    await step('James Whitfield')
    await skip(user)
    expect(await screen.findByText(/0 of 2 contacts logged\./)).toBeInTheDocument()
    expect(screen.getByText(/2 are still overdue\./)).toBeInTheDocument()
    expect(await screen.findByText('Home now shows 2 people overdue.')).toBeInTheDocument()
  })

  describe('step 2: finished screen', () => {
    it('lists who was logged with an Undo, and who is still overdue with Review again', async () => {
      const { mock } = logMock(ELENA, {})
      renderReview({ alerts: [[ELENA, JAMES], [JAMES]], mocks: [mock] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await logCurrent(user)
      await step('James Whitfield')
      await skip(user)
      await finishedHeading()

      expect(cardOf(/Logged today/)).toHaveTextContent(/Logged today\s*1/)
      expect(undoRow('Elena Petrova')).toHaveTextContent('Elena Petrova')
      expect(undoRow('Elena Petrova')).toHaveTextContent('Contact logged · comment added')
      expect(cardOf(/Still overdue/)).toHaveTextContent(/Still overdue\s*1/)
      const rows = overdueRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveTextContent('James Whitfield')
      expect(rows[0]).toHaveTextContent('Skipped · 3 days overdue')
    })

    it('words a logged prayer burden', async () => {
      const { mock } = logMock(ELENA, { prayerBurden: 'Her job' })
      renderReview({ alerts: [[ELENA], []], mocks: [mock] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await user.type(await screen.findByLabelText('Comment (required)'), 'Coffee')
      await user.type(screen.getByLabelText('Prayer burden (optional)'), 'Her job')
      await user.click(logButton())
      await finishedHeading()
      expect(undoRow('Elena Petrova')).toHaveTextContent(
        'Contact logged · comment and prayer burden added',
      )
    })

    it('says a new contact is now Active and when the next contact is due', async () => {
      const { mock } = logMock(TOM, { prayerBurden: 'Job' })
      renderReview({ alerts: [[TOM], []], mocks: [mock] })
      const user = userEvent.setup()
      await step('Tom Becker')
      await user.type(await screen.findByLabelText('Comment (required)'), 'Coffee')
      await user.type(screen.getByLabelText('Prayer burden (optional)'), 'Job')
      await user.click(logButton())
      await finishedHeading()
      expect(undoRow('Tom Becker')).toHaveTextContent(
        `Contact logged · now Active, next contact due ${formatShortDate(at(7 * DAY))} · prayer burden added`,
      )
    })

    it('has no Still overdue card when everyone was logged', async () => {
      const { mock } = logMock(ELENA, {})
      renderReview({ alerts: [[ELENA], []], mocks: [mock] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await logCurrent(user)
      await finishedHeading()
      expect(screen.getByRole('heading', { level: 2, name: /Logged today/ })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Still overdue/ })).not.toBeInTheDocument()
    })

    it('has no Logged today card when nothing was logged', async () => {
      renderReview({ alerts: [[ELENA]] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await skip(user)
      await finishedHeading()
      expect(screen.queryByRole('heading', { name: /Logged today/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 2, name: /Still overdue/ })).toBeInTheDocument()
    })
  })

  describe('step 2: undo on the finished screen', () => {
    it('deletes the contact and moves the person to Still overdue', async () => {
      const log = logMock(ELENA, {})
      const del = deleteMock(ELENA)
      renderReview({
        alerts: [[ELENA, JAMES], [JAMES], [ELENA, JAMES]],
        mocks: [log.mock, del.mock],
      })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await logCurrent(user)
      await step('James Whitfield')
      await skip(user)
      await finishedHeading()
      await user.click(
        screen.getByRole('button', { name: 'Undo contact logged for Elena Petrova' }),
      )

      await waitFor(() => expect(del.result).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Undo contact logged for Elena Petrova' }),
        ).not.toBeInTheDocument(),
      )
      expect(screen.queryByRole('heading', { name: /Logged today/ })).not.toBeInTheDocument()
      const rows = overdueRows()
      expect(rows.map((r) => r.textContent)).toEqual([
        expect.stringContaining('Elena Petrova'),
        expect.stringContaining('James Whitfield'),
      ])
      expect(rows[0]).toHaveTextContent('Contact removed · 14 days overdue')
      expect(cardOf(/Still overdue/)).toHaveTextContent(/Still overdue\s*2/)
      expect(screen.getByText(/0 of 2 contacts logged\./)).toBeInTheDocument()
      expect(screen.getByText(/2 are still overdue\./)).toBeInTheDocument()
      expect(await screen.findByText('Home now shows 2 people overdue.')).toBeInTheDocument()
    })

    it('keeps the row and shows why when the undo fails', async () => {
      const log = logMock(ELENA, {})
      const del = deleteMock(ELENA, notFound())
      renderReview({ alerts: [[ELENA], []], mocks: [log.mock, del.mock] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await logCurrent(user)
      await finishedHeading()
      await user.click(
        screen.getByRole('button', { name: 'Undo contact logged for Elena Petrova' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't undo. This was changed or removed by someone else.",
      )
      expect(
        screen.getByRole('button', { name: 'Undo contact logged for Elena Petrova' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /review again/i })).not.toBeInTheDocument()
    })

    it('undoing a new contact follow-up puts them back in Still overdue', async () => {
      const log = logMock(TOM, {})
      const del = deleteMock(TOM)
      renderReview({ alerts: [[TOM], [], [TOM]], mocks: [log.mock, del.mock] })
      const user = userEvent.setup()
      await step('Tom Becker')
      await logCurrent(user)
      await finishedHeading()
      await user.click(screen.getByRole('button', { name: 'Undo contact logged for Tom Becker' }))

      await waitFor(() => expect(overdueRows()).toHaveLength(1))
      expect(overdueRows()[0]).toHaveTextContent('Tom Becker')
      expect(overdueRows()[0]).toHaveTextContent('Contact removed · 2 days overdue')
      expect(screen.queryByRole('heading', { name: /Logged today/ })).not.toBeInTheDocument()
      expect(await screen.findByText('Home now shows 1 person overdue.')).toBeInTheDocument()
    })
  })

  describe('step 2: review again', () => {
    it('reopens a skipped person; logging returns to Finished with them logged', async () => {
      const { mock, result } = logMock(ELENA, {})
      renderReview({ alerts: [[ELENA, JAMES], [JAMES]], mocks: [mock] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await skip(user)
      await step('James Whitfield')
      await skip(user)
      await finishedHeading()
      expect(screen.queryByRole('heading', { name: /Logged today/ })).not.toBeInTheDocument()

      await user.click(within(overdueRows()[0]).getByRole('button', { name: /review again/i }))
      await step('Elena Petrova')
      expect(commentInput()).toBeInTheDocument()
      expect(skipButton()).toBeInTheDocument()
      expect(screen.getByText('This is the last person. A summary comes next.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Previous/ })).not.toBeInTheDocument()

      await logCurrent(user)
      const h1 = await finishedHeading()
      expect(result).toHaveBeenCalledTimes(1)
      expect(h1).toHaveFocus()
      expect(undoRow('Elena Petrova')).toBeInTheDocument()
      expect(overdueRows().map((r) => r.textContent)).toEqual([
        expect.stringContaining('James Whitfield'),
      ])
    })

    it('returns to Finished when skipped again', async () => {
      renderReview({ alerts: [[ELENA]] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await skip(user)
      await finishedHeading()
      await user.click(screen.getByRole('button', { name: /review again/i }))
      await step('Elena Petrova')
      await skip(user)
      expect(await finishedHeading()).toHaveFocus()
      expect(overdueRows()).toHaveLength(1)
    })
  })

  describe('step 2: previous', () => {
    it('goes back to a skipped person, who can be skipped again', async () => {
      renderReview({ alerts: [[ELENA, JAMES, RUTH]] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      expect(screen.queryByRole('button', { name: /^Previous/ })).not.toBeInTheDocument()
      await skip(user)
      await step('James Whitfield')
      await user.click(screen.getByRole('button', { name: 'Previous: Elena Petrova' }))

      expect(await step('Elena Petrova')).toHaveFocus()
      expect(screen.getByText('1 of 3')).toBeInTheDocument()
      expect(commentInput()).toBeInTheDocument()
      expect(logButton()).toBeInTheDocument()
      await skip(user)
      await step('James Whitfield')
      expect(screen.getByText('2 of 3')).toBeInTheDocument()
    })

    it('goes back to a logged person, shows the outcome, and Next goes forward', async () => {
      const { mock } = logMock(ELENA, {})
      renderReview({ alerts: [[ELENA, JAMES], [JAMES]], mocks: [mock] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await logCurrent(user)
      await step('James Whitfield')
      await user.click(screen.getByRole('button', { name: 'Previous: Elena Petrova' }))

      expect(await step('Elena Petrova')).toHaveFocus()
      expect(screen.getByRole('heading', { level: 3, name: 'Contact logged' })).toBeInTheDocument()
      expect(screen.getByText('Contact logged · comment added')).toBeInTheDocument()
      expect(screen.queryByLabelText('Comment (required)')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Log contact' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Next' }))
      await step('James Whitfield')
    })

    it('undo on a logged step deletes the contact and shows the form again', async () => {
      const log = logMock(ELENA, {})
      const del = deleteMock(ELENA)
      renderReview({
        alerts: [[ELENA, JAMES], [JAMES], [ELENA, JAMES]],
        mocks: [log.mock, del.mock],
      })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await logCurrent(user)
      await step('James Whitfield')
      await user.click(screen.getByRole('button', { name: 'Previous: Elena Petrova' }))
      await step('Elena Petrova')
      await user.click(
        screen.getByRole('button', { name: 'Undo contact logged for Elena Petrova' }),
      )

      expect(await screen.findByLabelText('Comment (required)')).toBeInTheDocument()
      expect(del.result).toHaveBeenCalledTimes(1)
      expect(
        screen.queryByRole('heading', { level: 3, name: 'Contact logged' }),
      ).not.toBeInTheDocument()
      expect(skipButton()).toBeInTheDocument()
    })
  })

  describe('step 2: people who changed since the queue was built', () => {
    it('notes someone contacted by another shepherd and moves on with Next', async () => {
      const fresh = active('p-elena', 'Elena Petrova', 2, { contactState: G.ContactState.OnTrack })
      renderReview({
        alerts: [[ELENA, JAMES]],
        details: { 'p-elena': detail(fresh) },
      })
      const user = userEvent.setup()
      await step('Elena Petrova')
      expect(
        await screen.findByText(
          `Elena was contacted ${timeAgo(fresh.lastContactedAt as string, NOW)} and isn't overdue any more.`,
        ),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Log contact' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Next' }))
      await step('James Whitfield')
      expect(within(queueOf()).getAllByRole('listitem')[0]).toHaveTextContent('Not overdue')
      await skip(user)

      await finishedHeading()
      expect(screen.getByText(/0 of 1 contact logged\./)).toBeInTheDocument()
      expect(screen.getByText(/1 is still overdue\./)).toBeInTheDocument()
      expect(overdueRows().map((r) => r.textContent)).toEqual([
        expect.stringContaining('James Whitfield'),
      ])
      expect(screen.queryByRole('heading', { name: /Logged today/ })).not.toBeInTheDocument()
    })

    it('says only "isn\'t overdue any more" when no contact was logged since the clock started', async () => {
      const fresh = person('p-elena', 'Elena Petrova', {
        lastContactedAt: null,
        contactClockStart: at(-1 * DAY),
        statusChangedAt: null,
        contactDueAt: at(6 * DAY),
        contactState: G.ContactState.OnTrack,
      })
      renderReview({ alerts: [[ELENA, JAMES]], details: { 'p-elena': detail(fresh) } })
      await step('Elena Petrova')
      expect(await screen.findByText("Elena isn't overdue any more.")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    })

    it('says someone is not tracked any more', async () => {
      const gone = person('p-elena', 'Elena Petrova', {
        status: { __typename: 'Status', id: 'st-inactive', name: 'inactive' },
        contactState: G.ContactState.NotTracked,
      })
      renderReview({ alerts: [[ELENA, JAMES]], details: { 'p-elena': detail(gone) } })
      await step('Elena Petrova')
      expect(await screen.findByText("Elena isn't tracked any more.")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    })
  })

  describe('step 2: people who no longer exist', () => {
    const missingCases: [string, () => Record<string, unknown>][] = [
      ['a null person', () => ({ data: { person: null } })],
      ['a NOT_FOUND error', notFound],
    ]

    it.each(missingCases)('drops %s from the queue silently', async (_n, result) => {
      renderReview({ alerts: [[ELENA, JAMES, RUTH]], mocks: [personMock('p-elena', result())] })
      await step('James Whitfield')
      expect(screen.getByText('1 of 2')).toBeInTheDocument()
      expect(within(queueOf()).getAllByRole('listitem')).toHaveLength(2)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each(missingCases)('finishes when the last person has %s', async (_n, result) => {
      renderReview({ alerts: [[ELENA, JAMES]], mocks: [personMock('p-james', result())] })
      const user = userEvent.setup()
      await step('Elena Petrova')
      await skip(user)
      await finishedHeading()
      expect(screen.getByText(/0 of 1 contact logged\./)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows the empty state when everyone is missing', async () => {
      renderReview({
        alerts: [[ELENA, JAMES]],
        mocks: [
          personMock('p-elena', { data: { person: null } }),
          personMock('p-james', notFound()),
        ],
      })
      expect(
        await screen.findByRole('heading', { level: 1, name: 'No one is overdue' }),
      ).toBeVisible()
    })
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
