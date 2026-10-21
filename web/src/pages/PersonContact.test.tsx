import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatShortDate } from '../format'
import * as G from '../generated/graphql'
import { PersonPage } from './PersonPage'

// Header calls useAuth(); the real provider would build a network client.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A Wednesday morning, local time.
const NOW = new Date(2026, 9, 14, 9, 41, 7)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const PERSON_ID = 'person-1'
const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const ACTIVE = { __typename: 'Status', id: 'st-active', name: 'active' }
const NEW = { __typename: 'Status', id: 'st-new', name: 'new contact' }
const INACTIVE = { __typename: 'Status', id: 'st-inactive', name: 'inactive' }

function contact(id: string, contactedAt: string, createdAt = contactedAt) {
  return { __typename: 'ContactLog', id, contactedAt, isFollowUp: false, createdAt }
}

function note(id: string, content: string, contactLogId: string | null = null) {
  return {
    __typename: 'Comment',
    id,
    content,
    createdAt: at(0),
    contactLogId,
    author: { __typename: 'User', id: ME.id, name: ME.name },
    prayerBurden: null,
  }
}

/** An active person, on track, last seen two days ago. */
function person(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id: PERSON_ID,
    name: 'Maria Santos',
    age: 34,
    yearMet: 2024,
    lastContactedAt: at(-2 * DAY),
    contactDueAt: at(5 * DAY),
    contactClockStart: at(-2 * DAY),
    statusChangedAt: null,
    contactState: G.ContactState.OnTrack,
    createdAt: at(-60 * DAY),
    isActive: true,
    status: ACTIVE,
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    lastPrayer: null,
    shepherds: [{ __typename: 'User', id: ME.id, name: ME.name }],
    milestones: [],
    prayerBurdens: [],
    comments: [],
    contacts: [contact('c-old', at(-2 * DAY))],
    prayers: [],
    ...overrides,
  }
}

/** A new contact added an hour ago, with nothing logged: 71 hours left. */
function newContact(overrides: Record<string, unknown> = {}) {
  return person({
    age: null,
    yearMet: null,
    lastContactedAt: null,
    contactDueAt: at(71 * HOUR),
    contactClockStart: at(-HOUR),
    statusChangedAt: null,
    createdAt: at(-HOUR),
    status: NEW,
    contacts: [],
    ...overrides,
  })
}

/** LogContact and DeleteContact return the summary and activity, not createdAt or milestones. */
function result(p: ReturnType<typeof person>) {
  const rest: Partial<typeof p> = { ...p }
  delete rest.createdAt
  delete rest.milestones
  return rest
}

/** The floating toast; the prayer box has its own, empty, status region. */
const toast = () => screen.getAllByRole('status').find((el) => el.textContent !== '') as HTMLElement

function LocationState() {
  return <div data-testid="location-state">{JSON.stringify(useLocation().state)}</div>
}

function renderPage(first: object, extra: MockedResponse[] = [], state?: unknown) {
  const mocks: MockedResponse[] = [
    {
      request: { query: G.PersonDocument, variables: { id: PERSON_ID } },
      result: { data: { person: first } },
    },
    ...[
      { request: { query: G.MeDocument }, result: { data: { me: ME } } },
      { request: { query: G.MilestonesDocument }, result: { data: { milestones: [] } } },
      // Logging and Undo reload both lists.
      { request: { query: G.MyPeopleDocument }, result: { data: { myPeople: [] } } },
      { request: { query: G.ContactAlertsDocument }, result: { data: { contactAlerts: [] } } },
    ].map((m) => ({ ...m, maxUsageCount: Number.POSITIVE_INFINITY })),
    ...extra,
  ]
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={[{ pathname: `/people/${PERSON_ID}`, state }]}>
        <Routes>
          <Route
            path="/people/:id"
            element={
              <>
                <PersonPage />
                <LocationState />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return userEvent.setup()
}

function logMock(input: G.LogContactInput, after: ReturnType<typeof person>) {
  const fn = vi.fn(() => ({ data: { logContact: result(after) } }))
  return {
    fn,
    mock: { request: { query: G.LogContactDocument, variables: { input } }, result: fn },
  }
}

function deleteMock(id: string, after: ReturnType<typeof person>) {
  const fn = vi.fn(() => ({ data: { deleteContact: result(after) } }))
  return {
    fn,
    mock: { request: { query: G.DeleteContactDocument, variables: { id } }, result: fn },
  }
}

const logButton = () => screen.findByRole('button', { name: 'Log contact' })
/** The status pill beside the name in the header card. */
const statusPill = () => screen.getByRole('heading', { level: 1 }).nextElementSibling as HTMLElement
const LOST = { __typename: 'Status', id: 'st-lost', name: 'lost contact' }
/** The About sidebar, and one Details row's value in it. */
const about = () => within(screen.getByRole('complementary', { name: 'About' }))
const detail = (label: string) =>
  about().getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement
const section = (name: string) =>
  screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement
const dialog = () => screen.getByRole('dialog', { name: 'Log contact with Maria' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('Person page contact banner', () => {
  it('is an alert with the days overdue for an overdue active person', async () => {
    renderPage(person({ contactState: G.ContactState.Overdue, contactDueAt: at(-3 * DAY) }))
    await logButton()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('3 days overdue')
    expect(within(alert).getByRole('button', { name: 'Log contact' })).toBeInTheDocument()
  })

  it('says when an active person is due soon', async () => {
    renderPage(person({ contactState: G.ContactState.DueSoon, contactDueAt: at(DAY) }))
    expect(await screen.findByText('Due in 1 day')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is on track with the days to the next contact', async () => {
    renderPage(person())
    expect(await screen.findByText('On track')).toBeInTheDocument()
    expect(
      screen.getByText('2 days since last contact. Next contact due in 5 days.'),
    ).toBeInTheDocument()
  })

  it('counts hours for a new contact', async () => {
    renderPage(newContact({ contactState: G.ContactState.DueSoon, contactDueAt: at(5 * HOUR) }))
    expect(await screen.findByText('5 hours left')).toBeInTheDocument()
  })

  it('says a new contact past 72 hours is overdue for follow-up', async () => {
    renderPage(newContact({ contactState: G.ContactState.Overdue, contactDueAt: at(-DAY) }))
    await logButton()
    expect(screen.getByRole('alert')).toHaveTextContent('Follow-up overdue')
  })

  it('offers Log contact with no urgency to someone not tracked', async () => {
    renderPage(
      person({
        status: INACTIVE,
        contactState: G.ContactState.NotTracked,
        contactDueAt: null,
        contactClockStart: null,
        statusChangedAt: null,
      }),
    )
    await logButton()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('On track')).not.toBeInTheDocument()
    expect(screen.getByText(/Contact reminders are off/)).toBeInTheDocument()
  })
})

describe('Person page details', () => {
  it('shows a new contact with nothing recorded', async () => {
    renderPage(newContact())
    expect(
      await screen.findByText('Added 1 hour ago. 71 hours left to log a contact.'),
    ).toBeInTheDocument()
    expect(detail('Last contact')).toHaveTextContent('None yet')
    expect(detail('Age')).toHaveTextContent('Not recorded')
    expect(detail('Added')).toHaveTextContent('1 hour ago')
    expect(section('Contact rule')).toHaveTextContent(
      'A new contact needs a follow-up within 72 hours of being added. When you log it, they become Active.',
    )
    expect(screen.getByText('0 of 4')).toBeInTheDocument()
    expect(
      screen.getByText('No prayer burdens yet. Add one here, or when you log a contact.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('No notes yet. A comment written when you log a contact shows here.'),
    ).toBeInTheDocument()
  })

  it('has no Added row for an active person, and states the 7-day rule', async () => {
    renderPage(person())
    await logButton()
    expect(about().queryByText('Added', { selector: 'dt' })).not.toBeInTheDocument()
    expect(section('Contact rule')).toHaveTextContent(
      'Active people are contacted at least once every 7 days after the last contact. An alert shows on Home when this passes.',
    )
  })

  it('labels a note written when logging a contact with that contact’s date', async () => {
    renderPage(
      person({
        comments: [note('n1', 'Coffee after church', 'c-old'), note('n2', 'Plain note')],
      }),
    )
    expect(await screen.findByText('Coffee after church')).toBeInTheDocument()
    expect(screen.getAllByText(/^Logged contact/)).toHaveLength(1)
    expect(
      screen.getByText(`Logged contact · ${formatShortDate(at(-2 * DAY))}`),
    ).toBeInTheDocument()
  })
})

describe('Logging a contact from the Person page', () => {
  it('opens from the banner, saves, and updates the page with the note and burden', async () => {
    const after = person({
      lastContactedAt: at(0),
      contactDueAt: at(7 * DAY),
      contactClockStart: at(0),
      statusChangedAt: null,
      prayerBurdens: [
        {
          __typename: 'PrayerBurden',
          id: 'b1',
          content: 'New job',
          releasedDate: null,
          createdAt: at(0),
        },
      ],
      comments: [note('n1', 'Coffee after church', 'c-new')],
      contacts: [contact('c-new', at(0)), contact('c-old', at(-2 * DAY))],
    })
    const { fn, mock } = logMock(
      {
        personId: PERSON_ID,
        contactedAt: NOW.toISOString(),
        note: 'Coffee after church',
        prayerBurden: 'New job',
      },
      after,
    )
    const user = renderPage(person(), [mock])
    await user.click(await logButton())
    await user.type(screen.getByLabelText('Comment (required)'), 'Coffee after church')
    await user.type(screen.getByLabelText('Prayer burden (optional)'), 'New job')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(await screen.findByText('Coffee after church')).toBeInTheDocument()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(`Logged contact · ${formatShortDate(at(0))}`)).toBeInTheDocument()
    expect(screen.getByText('New job')).toBeInTheDocument()
    expect(screen.getByText('Added today · Praying')).toBeInTheDocument()
    expect(screen.getByText('Contacted today. Next contact due in 7 days.')).toBeInTheDocument()
    expect(toast()).toHaveTextContent('Contact logged with Maria.')
  })

  it('moves a new contact to active, and Undo moves them back', async () => {
    const before = newContact()
    const after = person({
      lastContactedAt: at(0),
      contactDueAt: at(7 * DAY),
      contactClockStart: at(0),
      statusChangedAt: null,
      comments: [note('n1', 'Met for lunch', 'c-new')],
      contacts: [contact('c-new', at(0))],
    })
    const logged = logMock(
      { personId: PERSON_ID, contactedAt: NOW.toISOString(), note: 'Met for lunch' },
      after,
    )
    const undone = deleteMock('c-new', before)
    const user = renderPage(before, [logged.mock, undone.mock])

    await user.click(await logButton())
    expect(within(dialog()).getByText(/moves Maria to Active/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Comment (required)'), 'Met for lunch')
    await user.click(screen.getByRole('button', { name: 'Save contact' }))

    expect(
      await screen.findByText('Contacted today. Next contact due in 7 days.'),
    ).toBeInTheDocument()
    expect(statusPill()).toHaveTextContent(/^Active$/)
    expect(toast()).toHaveTextContent('Maria is now Active.')

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Contact with Maria removed.')).toBeInTheDocument()
    expect(undone.fn).toHaveBeenCalledTimes(1)
    expect(statusPill()).toHaveTextContent(/^New contact$/)
    expect(screen.queryByText('Met for lunch')).not.toBeInTheDocument()
    expect(
      screen.getByText('No notes yet. A comment written when you log a contact shows here.'),
    ).toBeInTheDocument()
  })

  it('opens the dialog on arrival when asked to, then clears the request', async () => {
    renderPage(newContact(), [], { logContact: true })
    expect(
      await screen.findByRole('dialog', { name: 'Log contact with Maria' }),
    ).toBeInTheDocument()
    // The effect's navigate lands in a later render than the one that opens the dialog.
    await waitFor(() => expect(screen.getByTestId('location-state')).toHaveTextContent('null'))
  })

  it('does not open the dialog on a plain visit', async () => {
    renderPage(person())
    await logButton()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Cancel closes the dialog without logging', async () => {
    const user = renderPage(person())
    await user.click(await logButton())
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

/** The header's subtitle line, matched on its whole text (parts of it are wrapped for phones). */
const subtitle = (re: RegExp) =>
  screen.getByText((_, el) => el?.tagName === 'P' && re.test(el.textContent ?? ''))
const bar = (name: string) => screen.getByRole('img', { name })
const fillWidth = (img: HTMLElement) => {
  const fill = img.querySelector<HTMLElement>('[style*="width"]')
  expect(fill).not.toBeNull()
  return Number.parseFloat(fill?.style.width ?? '')
}

describe('Person page header', () => {
  it('has a breadcrumb back to My people ending in the name', async () => {
    renderPage(person())
    await logButton()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'My people' })).toHaveAttribute(
      'href',
      '/people',
    )
    expect(crumbs).toHaveTextContent('Maria Santos')
    expect(screen.queryByText('← My people')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Maria Santos' })).toBeInTheDocument()
  })

  it('shows the status word as a pill', async () => {
    renderPage(newContact())
    await logButton()
    expect(statusPill()).toHaveTextContent(/^New contact$/)
  })

  it('shows Inactive for an inactive person', async () => {
    renderPage(
      person({
        status: INACTIVE,
        contactState: G.ContactState.NotTracked,
        contactDueAt: null,
        contactClockStart: null,
      }),
    )
    await logButton()
    expect(statusPill()).toHaveTextContent(/^Inactive$/)
  })

  it('has a subtitle with age, year met and shepherds', async () => {
    renderPage(
      person({
        yearMet: 2020,
        shepherds: [
          { __typename: 'User', id: ME.id, name: ME.name },
          { __typename: 'User', id: 'u-grace', name: 'Grace Lin' },
        ],
      }),
    )
    await logButton()
    expect(subtitle(/Met 2020/)).toHaveTextContent(
      '34 years old · Met 2020 · Shepherded by you and Grace Lin',
    )
  })

  it('leaves out the age when it is not known', async () => {
    renderPage(person({ age: null, yearMet: 2020 }))
    await logButton()
    expect(subtitle(/Met 2020/)).toHaveTextContent(/^Met 2020 · Shepherded by you$/)
  })

  it('leaves out Met when the year is not known', async () => {
    renderPage(person({ yearMet: null }))
    await logButton()
    const sub = subtitle(/Shepherded by you/)
    expect(sub).toHaveTextContent(/^34 years old · Shepherded by you$/)
    expect(sub).not.toHaveTextContent(/Met/)
  })

  it('is just the shepherds when age and year are both unknown', async () => {
    renderPage(person({ age: null, yearMet: null }))
    await logButton()
    expect(subtitle(/Shepherded by you/)).toHaveTextContent(/^Shepherded by you$/)
  })

  it('lists three shepherds with you first', async () => {
    renderPage(
      person({
        shepherds: [
          { __typename: 'User', id: 'u-grace', name: 'Grace Lin' },
          { __typename: 'User', id: 'u-sam', name: 'Sam Lee' },
          { __typename: 'User', id: ME.id, name: ME.name },
        ],
      }),
    )
    await logButton()
    expect(subtitle(/Shepherded by/)).toHaveTextContent('Shepherded by you, Grace Lin and Sam Lee')
  })

  it('says how long ago a new contact was added, and not for an active person', async () => {
    renderPage(newContact({ createdAt: at(-20 * HOUR), contactClockStart: at(-20 * HOUR) }))
    await logButton()
    expect(subtitle(/Shepherded by you/)).toHaveTextContent('Added 20 hours ago')
  })

  it('has no Added part in the subtitle of an active person', async () => {
    renderPage(person())
    await logButton()
    expect(subtitle(/Shepherded by you/)).not.toHaveTextContent(/Added/)
  })

  it('Edit details opens the edit form', async () => {
    const user = renderPage(person())
    await user.click(await screen.findByRole('button', { name: 'Edit details' }))
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('Add note about the person focuses the Notes field, distinct from the form submit', async () => {
    const user = renderPage(person())
    const shortcut = await screen.findByRole('button', { name: 'Add note about Maria' })
    expect(shortcut).toHaveTextContent('Add note')
    expect(screen.getByRole('button', { name: 'Add note' })).not.toBe(shortcut)
    await user.click(shortcut)
    expect(screen.getByLabelText('Write a note about Maria')).toHaveFocus()
  })
})

describe('Person page contact panel sub line and bar', () => {
  it('says contacted today for a contact made today', async () => {
    renderPage(
      person({
        lastContactedAt: at(0),
        contactClockStart: at(0),
        contactDueAt: at(7 * DAY),
        contacts: [contact('c-now', at(0))],
      }),
    )
    expect(await screen.findByText('On track')).toBeInTheDocument()
    const img = bar('Contacted today. Next contact due in 7 days.')
    expect(fillWidth(img)).toBeGreaterThanOrEqual(4)
  })

  it('fills the bar in proportion to the time used', async () => {
    renderPage(person())
    await logButton()
    expect(fillWidth(bar('2 days since last contact. Next contact due in 5 days.'))).toBeCloseTo(
      (2 / 7) * 100,
      0,
    )
  })

  it('gives an active person who is due soon the goal', async () => {
    renderPage(
      person({
        contactState: G.ContactState.DueSoon,
        lastContactedAt: at(-6 * DAY),
        contactClockStart: at(-6 * DAY),
        contactDueAt: at(DAY),
        contacts: [contact('c-old', at(-6 * DAY))],
      }),
    )
    expect(await screen.findByText('Due in 1 day')).toBeInTheDocument()
    const img = bar('6 days since last contact. Goal is every 7 days.')
    expect(fillWidth(img)).toBeCloseTo((6 / 7) * 100, 0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('fills the bar for an overdue active person', async () => {
    renderPage(
      person({
        contactState: G.ContactState.Overdue,
        lastContactedAt: at(-10 * DAY),
        contactClockStart: at(-10 * DAY),
        contactDueAt: at(-3 * DAY),
        contacts: [contact('c-old', at(-10 * DAY))],
      }),
    )
    await logButton()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(fillWidth(bar('10 days since last contact. Goal is every 7 days.'))).toBe(100)
  })

  it('shows a sliver of the bar for a new contact on track', async () => {
    renderPage(newContact())
    await logButton()
    const img = bar('Added 1 hour ago. 71 hours left to log a contact.')
    expect(fillWidth(img)).toBeGreaterThanOrEqual(4)
    expect(fillWidth(img)).toBeLessThan(100)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('gives a new contact who is due soon the 72 hour goal', async () => {
    renderPage(
      newContact({
        contactState: G.ContactState.DueSoon,
        createdAt: at(-48 * HOUR),
        contactClockStart: at(-48 * HOUR),
        contactDueAt: at(24 * HOUR),
      }),
    )
    expect(await screen.findByText('24 hours left')).toBeInTheDocument()
    expect(fillWidth(bar('Added 2 days ago. Follow up within 72 hours.'))).toBeCloseTo(
      (48 / 72) * 100,
      0,
    )
  })

  it('gives an overdue new contact the 72 hour goal and a full bar', async () => {
    renderPage(
      newContact({
        contactState: G.ContactState.Overdue,
        createdAt: at(-78 * HOUR),
        contactClockStart: at(-78 * HOUR),
        contactDueAt: at(-6 * HOUR),
      }),
    )
    await logButton()
    expect(screen.getByRole('alert')).toHaveTextContent('Follow-up overdue')
    expect(fillWidth(bar('Added 3 days ago. Follow up within 72 hours.'))).toBe(100)
  })

  it('says the clock restarted when an active person was moved', async () => {
    renderPage(
      person({
        lastContactedAt: at(-10 * DAY),
        contactClockStart: at(-2 * DAY),
        contactDueAt: at(5 * DAY),
        contacts: [contact('c-old', at(-10 * DAY))],
      }),
    )
    expect(
      await screen.findByText('Moved to Active 2 days ago. Next contact due in 5 days.'),
    ).toBeInTheDocument()
  })

  it('says the clock restarted when a person was moved to new contact', async () => {
    renderPage(
      newContact({
        createdAt: at(-30 * DAY),
        contactClockStart: at(-5 * HOUR),
        contactDueAt: at(67 * HOUR),
      }),
    )
    expect(
      await screen.findByText('Moved to New contact 5 hours ago. 67 hours left to log a contact.'),
    ).toBeInTheDocument()
  })

  it('says no contact was logged for an active person never contacted', async () => {
    renderPage(
      person({
        lastContactedAt: null,
        contactClockStart: at(-3 * DAY),
        createdAt: at(-3 * DAY),
        contactDueAt: at(4 * DAY),
        contacts: [],
      }),
    )
    expect(
      await screen.findByText('Added 3 days ago, no contact logged. Next contact due in 4 days.'),
    ).toBeInTheDocument()
  })

  it('has no headline, sub line, bar or alert for someone not tracked, but can log contact', async () => {
    renderPage(
      person({
        status: INACTIVE,
        contactState: G.ContactState.NotTracked,
        contactDueAt: null,
        contactClockStart: null,
      }),
    )
    await logButton()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(/since last contact/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Goal is every/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Contact reminders are off/)).toHaveLength(1)
  })

  it('opens the Log contact dialog from the panel', async () => {
    const user = renderPage(
      person({ contactState: G.ContactState.Overdue, contactDueAt: at(-DAY) }),
    )
    await user.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Log contact' }),
    )
    expect(dialog()).toBeInTheDocument()
  })
})

describe('Person page layout', () => {
  it('keeps the shepherds and Delete person in the aside, and the sections in the main column', async () => {
    renderPage(person())
    await logButton()
    const aside = screen.getByRole('complementary', { name: 'About' })
    expect(within(aside).getByRole('heading', { level: 2, name: 'Shepherds' })).toBeInTheDocument()
    expect(within(aside).getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument()
    expect(
      within(aside).getByRole('heading', { level: 2, name: 'Contact rule' }),
    ).toBeInTheDocument()
    expect(within(aside).getByRole('button', { name: 'Delete Maria Santos' })).toHaveTextContent(
      'Delete Maria Santos',
    )
    for (const name of ['Milestones', 'Prayer burdens', 'Notes']) {
      const heading = screen.getByRole('heading', { level: 2, name })
      expect(aside).not.toContainElement(heading)
    }
  })
})

describe('Person page sidebar Details', () => {
  it('shows the rows for an active person: no Added and no Active yes/no row', async () => {
    renderPage(person())
    await logButton()
    expect(detail('Age')).toHaveTextContent('34')
    expect(detail('Year met')).toHaveTextContent('2024')
    expect(detail('Last contact')).toHaveTextContent('2 days ago')
    expect(detail('Status')).toHaveTextContent(/^Active$/)
    expect(about().queryByText('Added', { selector: 'dt' })).not.toBeInTheDocument()
    expect(about().queryByText('Active', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('shows Added as a span for a new contact, still with no Active row', async () => {
    renderPage(newContact({ createdAt: at(-20 * HOUR), contactClockStart: at(-20 * HOUR) }))
    await logButton()
    expect(detail('Added')).toHaveTextContent('20 hours ago')
    expect(detail('Status')).toHaveTextContent(/^New contact$/)
    expect(about().queryByText('Active', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('says under an hour ago for a contact added minutes ago', async () => {
    renderPage(newContact({ createdAt: at(-10 * 60_000), contactClockStart: at(-10 * 60_000) }))
    await logButton()
    expect(detail('Added')).toHaveTextContent('under an hour ago')
  })

  it('says None yet for the last contact of a person with no contacts', async () => {
    renderPage(person({ lastContactedAt: null, contacts: [] }))
    await logButton()
    expect(detail('Last contact')).toHaveTextContent('None yet')
  })

  it('says Today for a contact made today', async () => {
    renderPage(person({ lastContactedAt: at(0), contacts: [contact('c-now', at(0))] }))
    await logButton()
    expect(detail('Last contact')).toHaveTextContent('Today')
  })

  it.each([
    [3 * DAY, '3 days ago'],
    [7 * DAY, '1 week ago'],
  ])('says how long ago the last contact was (%i ms back: %s)', async (back, text) => {
    renderPage(person({ lastContactedAt: at(-back), contacts: [contact('c-old', at(-back))] }))
    await logButton()
    expect(detail('Last contact')).toHaveTextContent(text)
  })

  it.each([
    [ACTIVE, 'Active'],
    [NEW, 'New contact'],
    [INACTIVE, 'Inactive'],
    [LOST, 'Lost contact'],
  ])('shows the status label in the Status row (%o)', async (status, label) => {
    renderPage(person({ status, contactState: G.ContactState.NotTracked }))
    await logButton()
    expect(detail('Status')).toHaveTextContent(new RegExp(`^${label}$`))
  })

  it('shows a person with nothing recorded without crashing', async () => {
    renderPage(newContact({ shepherds: [], milestones: [], prayerBurdens: [], comments: [] }))
    await logButton()
    expect(detail('Age')).toHaveTextContent('Not recorded')
    expect(detail('Last contact')).toHaveTextContent('None yet')
  })
})

describe('Person page sidebar Contact rule', () => {
  const OFF = 'Contact reminders are off while they are inactive or lost contact.'
  it.each([
    [
      'new contact',
      NEW,
      'A new contact needs a follow-up within 72 hours of being added. When you log it, they become Active.',
    ],
    [
      'active',
      ACTIVE,
      'Active people are contacted at least once every 7 days after the last contact. An alert shows on Home when this passes.',
    ],
    ['inactive', INACTIVE, OFF],
    ['lost contact', LOST, OFF],
  ])('states the rule for %s', async (_name, status, text) => {
    renderPage(person({ status, contactState: G.ContactState.NotTracked }))
    await logButton()
    expect(section('Contact rule')).toHaveTextContent(text)
  })
})
