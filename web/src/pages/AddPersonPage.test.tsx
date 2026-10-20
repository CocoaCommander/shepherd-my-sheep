import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatShortDate } from '../format'
import * as G from '../generated/graphql'
import { AddPersonPage } from './AddPersonPage'

// Header calls useAuth(); the real provider would build a network client.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const HOUR = 3_600_000
// A Wednesday morning in 2026, local time.
const NOW = new Date(2026, 9, 14, 9, 41, 7)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const DUE_AT = at(72 * HOUR)

const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const NEW = { __typename: 'Status', id: 'st-new', name: 'new contact' }
const STATUSES = [{ __typename: 'Status', id: 'st-active', name: 'active' }, NEW]

/** What createPerson returns for someone just added. */
function added(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id: 'person-new',
    name: 'Maria Santos',
    age: null,
    yearMet: 2026,
    lastContactedAt: null,
    contactDueAt: DUE_AT,
    contactClockStart: at(0),
    contactState: G.ContactState.OnTrack,
    isActive: true,
    status: NEW,
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds: [{ __typename: 'User', id: ME.id, name: ME.name }],
    createdAt: at(0),
    ...overrides,
  }
}

function createMock(input: G.CreatePersonInput, person = added()) {
  const fn = vi.fn(() => ({ data: { createPerson: person } }))
  return {
    fn,
    mock: { request: { query: G.CreatePersonDocument, variables: { input } }, result: fn },
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{JSON.stringify([location.pathname, location.state])}</div>
}

function renderPage(extra: MockedResponse[] = []) {
  const mocks: MockedResponse[] = [
    ...[
      { request: { query: G.StatusesDocument }, result: { data: { statuses: STATUSES } } },
      { request: { query: G.MeDocument }, result: { data: { me: ME } } },
      { request: { query: G.ContactAlertsDocument }, result: { data: { contactAlerts: [] } } },
      // Adding someone reloads My people.
      { request: { query: G.MyPeopleDocument }, result: { data: { myPeople: [] } } },
    ].map((m) => ({ ...m, maxUsageCount: Number.POSITIVE_INFINITY })),
    ...extra,
  ]
  render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={['/people/new']}>
        <Routes>
          <Route path="/people/new" element={<AddPersonPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return userEvent.setup()
}

/** The submit button is off until the statuses load and give the 'new contact' id. */
async function addButton() {
  const button = screen.getByRole('button', { name: 'Add person' })
  await vi.waitFor(() => expect(button).toBeEnabled())
  return button
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('Add person page', () => {
  it('shows the form, the read-only status and shepherd, and what happens next', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Add a person' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toHaveValue('')
    expect(screen.getByRole('spinbutton', { name: 'Age (optional)' })).toHaveValue(null)
    expect(screen.getByRole('spinbutton', { name: 'Year met (optional)' })).toHaveValue(2026)
    expect(screen.getByRole('textbox', { name: 'Comment (optional)' })).toHaveAccessibleDescription(
      'Saved as a note on their page. You can leave it empty.',
    )
    expect(screen.getByText('New contact')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()

    const steps = screen.getByRole('region', { name: 'What happens next' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3)
    // No deadline until the server has one.
    expect(steps).not.toHaveTextContent(/By /)

    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/people')
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'My people' })).toHaveAttribute(
      'href',
      '/people',
    )
    await addButton()
  })

  it('asks for a name, and focuses it', async () => {
    const { fn, mock } = createMock({ name: '', statusId: NEW.id, age: null, yearMet: 2026 })
    const user = renderPage([mock])
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), '   ')
    await user.click(await addButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.')
    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toHaveFocus()
    expect(fn).not.toHaveBeenCalled()

    // Typing clears it.
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), 'M')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['-1', 'Enter an age between 0 and 120.'],
    ['121', 'Enter an age between 0 and 120.'],
    ['2.5', 'Enter an age between 0 and 120.'],
  ])('rejects age %s', async (age, message) => {
    const user = renderPage()
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), 'Maria')
    await user.type(screen.getByRole('spinbutton', { name: 'Age (optional)' }), age)
    await user.click(await addButton())

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('spinbutton', { name: 'Age (optional)' })).toHaveFocus()
  })

  it.each(['1899', '2027'])('rejects year met %s, bounded by the current year', async (year) => {
    const user = renderPage()
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), 'Maria')
    const yearMet = screen.getByRole('spinbutton', { name: 'Year met (optional)' })
    await user.clear(yearMet)
    await user.type(yearMet, year)
    await user.click(await addButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a year from 1900 to 2026.')
    expect(yearMet).toHaveFocus()
  })

  it('shows every error at once and focuses the first', async () => {
    const user = renderPage()
    await user.type(screen.getByRole('spinbutton', { name: 'Age (optional)' }), '200')
    await user.clear(screen.getByRole('spinbutton', { name: 'Year met (optional)' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Year met (optional)' }), '1800')
    await user.click(await addButton())

    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      'Enter a name.',
      'Enter an age between 0 and 120.',
      'Enter a year from 1900 to 2026.',
    ])
    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toHaveFocus()
  })

  it('adds them as a new contact and confirms with the deadline from the server', async () => {
    const { fn, mock } = createMock(
      {
        name: 'Maria Santos',
        statusId: NEW.id,
        age: 34,
        yearMet: 2024,
        comment: 'Met at the cafe.',
      },
      added({ age: 34, yearMet: 2024 }),
    )
    const user = renderPage([mock])
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), '  Maria Santos ')
    await user.type(screen.getByRole('spinbutton', { name: 'Age (optional)' }), '34')
    const yearMet = screen.getByRole('spinbutton', { name: 'Year met (optional)' })
    await user.clear(yearMet)
    await user.type(yearMet, '2024')
    await user.type(
      screen.getByRole('textbox', { name: 'Comment (optional)' }),
      ' Met at the cafe. ',
    )
    await user.click(await addButton())

    const heading = await screen.findByRole('heading', { level: 1, name: 'Maria Santos added' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(heading).toHaveFocus()
    const due = formatShortDate(DUE_AT)
    expect(
      screen.getByText(
        `Log a contact with Maria within 72 hours, by ${due}. If that passes, an alert shows on Home.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'What happens next' })).toHaveTextContent(
      `By ${due}.`,
    )
  })

  it('leaves out a blank comment and sends blank age and year as null', async () => {
    const { fn, mock } = createMock({ name: 'Maria', statusId: NEW.id, age: null, yearMet: null })
    const user = renderPage([mock])
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), 'Maria')
    await user.clear(screen.getByRole('spinbutton', { name: 'Year met (optional)' }))
    await user.type(screen.getByRole('textbox', { name: 'Comment (optional)' }), '   ')
    await user.click(await addButton())

    expect(await screen.findByRole('heading', { name: 'Maria Santos added' })).toBeInTheDocument()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('shows a server error and keeps the form', async () => {
    const user = renderPage([
      {
        request: {
          query: G.CreatePersonDocument,
          variables: { input: { name: 'Maria', statusId: NEW.id, age: null, yearMet: 2026 } },
        },
        result: {
          errors: [{ message: 'A value is too long', extensions: { code: 'BAD_USER_INPUT' } }],
        },
      },
    ])
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), 'Maria')
    await user.click(await addButton())

    expect(await screen.findByText(/A value is too long/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toHaveValue('Maria')
  })

  async function addMaria() {
    const { mock } = createMock({ name: 'Maria', statusId: NEW.id, age: null, yearMet: 2026 })
    const user = renderPage([mock])
    await user.type(screen.getByRole('textbox', { name: 'Name (required)' }), 'Maria')
    await user.click(await addButton())
    await screen.findByRole('heading', { name: 'Maria Santos added' })
    return user
  }

  it('"Log contact now" opens their page and asks it to open the dialog', async () => {
    const user = await addMaria()
    await user.click(screen.getByRole('link', { name: 'Log contact now' }))
    expect(screen.getByTestId('location')).toHaveTextContent(
      JSON.stringify(['/people/person-new', { logContact: true }]),
    )
  })

  it('"Add another person" brings back an empty form', async () => {
    const user = await addMaria()
    await user.click(screen.getByRole('button', { name: 'Add another person' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Add a person' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name (required)' })).toHaveValue('')
    expect(screen.getByRole('spinbutton', { name: 'Year met (optional)' })).toHaveValue(2026)
    expect(screen.getByRole('region', { name: 'What happens next' })).not.toHaveTextContent(/By /)
  })

  it('"Back to My people" links to the list', async () => {
    await addMaria()
    expect(screen.getByRole('link', { name: 'Back to My people' })).toHaveAttribute(
      'href',
      '/people',
    )
  })
})
