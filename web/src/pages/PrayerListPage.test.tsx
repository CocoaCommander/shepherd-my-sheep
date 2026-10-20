import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { PrayerListPage } from './PrayerListPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }
const OTHER = { __typename: 'User', id: 'user-other', name: 'Olivia Other' }
const FRIENDLY = 'Something went wrong. Please try again.'

const DAY = 24 * 3_600_000
// An API DateTime `days` days (plus a margin, so day counts are stable) before now.
const ago = (days: number) =>
  new Date(Date.now() - days * DAY - 3_600_000).toISOString().replace('T', ' ').replace('Z', '+00')

const STATUS = {
  active: { __typename: 'Status', id: 'st-active', name: 'active' },
  new: { __typename: 'Status', id: 'st-new', name: 'new contact' },
  inactive: { __typename: 'Status', id: 'st-inactive', name: 'inactive' },
  lost: { __typename: 'Status', id: 'st-lost', name: 'lost contact' },
}

function burden(
  id: string,
  content: string,
  createdAt: string,
  personId: string,
  name: string,
  opts: { status?: (typeof STATUS)[keyof typeof STATUS]; comments?: object[] } = {},
) {
  return {
    __typename: 'PrayerBurden',
    id,
    content,
    createdAt,
    releasedDate: null,
    person: {
      __typename: 'Person',
      id: personId,
      name,
      status: opts.status ?? STATUS.active,
    },
    comments: opts.comments ?? [],
  }
}

function comment(id: string, content: string, createdAt: string, author: object) {
  return { __typename: 'Comment', id, content, createdAt, author }
}

const B_ZED_NEW = burden('b1', 'Zed new burden', ago(10), 'p-zed', 'Zed Zimmer', {
  comments: [
    comment('c1', 'Spoke on Sunday', ago(2), { __typename: 'User', id: ME.id, name: ME.name }),
    comment('c0', 'Older note', ago(8), { ...OTHER }),
  ],
})
const B_ZED_OLD = burden('b2', 'Zed old burden', ago(100), 'p-zed', 'Zed Zimmer')
const B_ADA = burden('b3', 'Ada burden', ago(40), 'p-ada', 'Ada Adams', {
  status: STATUS.new,
  comments: [comment('c2', 'Prayed together', ago(1), { ...OTHER })],
})

const PERSON_SUMMARY = {
  __typename: 'Person',
  id: 'p-ada',
  name: 'Ada Adams',
  age: null,
  yearMet: null,
  lastContactedAt: null,
  contactDueAt: null,
  contactClockStart: null,
  contactState: G.ContactState.NotTracked,
  isActive: true,
  status: STATUS.active,
  recordedMilestoneIds: [],
  activeBurdenCount: 1,
  latestComment: null,
  shepherds: [],
  createdAt: ago(90),
}

const forever = Number.POSITIVE_INFINITY

interface Setup {
  /** Successive results of ActivePrayerBurdens; the last one repeats. */
  lists?: (object[] | Error)[]
  people?: object[]
  extra?: MockedResponse[]
}

function renderPage({ lists = [[]], people = [PERSON_SUMMARY], extra = [] }: Setup = {}) {
  const listCalls = vi.fn()
  const mocks: MockedResponse[] = [
    ...lists.map((list, i): MockedResponse => ({
      request: { query: G.ActivePrayerBurdensDocument },
      result: () => {
        listCalls()
        return list instanceof Error
          ? { errors: [new GraphQLError(list.message, { extensions: { code: 'INTERNAL' } })] }
          : { data: { activePrayerBurdens: list } }
      },
      maxUsageCount: i === lists.length - 1 ? forever : 1,
    })),
    {
      request: { query: G.MyPeopleDocument },
      result: { data: { myPeople: people } },
      maxUsageCount: forever,
    },
    {
      request: { query: G.MeDocument },
      result: { data: { me: ME } },
      maxUsageCount: forever,
    },
    {
      // The header's bell.
      request: { query: G.ContactAlertsDocument },
      result: { data: { contactAlerts: [] } },
      maxUsageCount: forever,
    },
    ...extra,
  ]
  const utils = render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter initialEntries={['/prayer']}>
        <Routes>
          <Route path="/prayer" element={<PrayerListPage />} />
          <Route path="/people/new" element={<p>Add person stub</p>} />
          <Route path="/people/:id" element={<StubPerson />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  return { ...utils, listCalls }
}

function StubPerson() {
  const { id } = useParams()
  return <p>Person stub {id}</p>
}

/** Burden contents in the order the rows appear. */
function order(contents: string[]) {
  return screen.getAllByRole('article').map((a) => contents.find((c) => a.textContent?.includes(c)))
}

const ALL = ['Zed new burden', 'Zed old burden', 'Ada burden']
// The comment line is split across elements; match the paragraph's whole text.
const lineText = (text: string) => (_: string, el: Element | null) =>
  el?.tagName === 'P' && el.textContent?.replace(/\s+/g, ' ').trim() === text
// jsdom drops the space around the screen-reader-only span, so tolerate its absence.
const commentName = (name: string, count = '') =>
  new RegExp(`^Comment\\s*on prayer burden for ${name}${count ? ` \\(${count}\\)` : ''}$`)
const row = (content: string) => screen.getByText(content).closest('article') as HTMLElement

function releaseMutation(id: string, b: object, opts: { error?: string; delay?: number } = {}) {
  return {
    request: { query: G.ReleasePrayerBurdenDocument, variables: { id } },
    result: opts.error
      ? {
          errors: [
            new GraphQLError(opts.error === 'BAD_USER_INPUT' ? 'Already released' : 'denied', {
              extensions: { code: opts.error },
            }),
          ],
        }
      : { data: { releasePrayerBurden: { ...b, releasedDate: '2026-10-20' } } },
    delay: opts.delay,
  } as MockedResponse
}

function unreleaseMutation(id: string, b: object, error?: string) {
  return {
    request: { query: G.UnreleasePrayerBurdenDocument, variables: { id } },
    result: error
      ? { errors: [new GraphQLError('gone', { extensions: { code: error } })] }
      : { data: { unreleasePrayerBurden: b } },
  } as MockedResponse
}

describe('Prayer list page empty states', () => {
  it('with zero people, invites adding one and shows no controls', async () => {
    renderPage({ people: [] })
    expect(screen.getByRole('heading', { level: 1, name: 'Prayer list' })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'No one is assigned to you yet' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add person' })).toHaveAttribute('href', '/people/new')
    expect(screen.queryByRole('group', { name: 'Sort' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Filter by person' })).not.toBeInTheDocument()
  })

  it('with people but no burdens, says there are none', async () => {
    renderPage({ lists: [[]] })
    expect(
      await screen.findByText('No active prayer burdens here. Add one when something comes up.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByText('No one is assigned to you yet')).not.toBeInTheDocument()
  })

  it('shows the friendly message in an alert when the query fails', async () => {
    renderPage({ lists: [new Error('db exploded')] })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(FRIENDLY)).toBeInTheDocument()
    expect(screen.queryByText('db exploded')).not.toBeInTheDocument()
  })
})

describe('Prayer list page rows', () => {
  it('summarises burdens and people', async () => {
    renderPage({ lists: [[B_ZED_NEW, B_ZED_OLD, B_ADA]] })
    expect(await screen.findByText('3 active burdens across 2 people')).toBeInTheDocument()
  })

  it('uses singular wording for one burden and one person', async () => {
    renderPage({ lists: [[B_ADA]] })
    expect(await screen.findByText('1 active burden across 1 person')).toBeInTheDocument()
  })

  it('shows person link, status, age, content and the latest comment', async () => {
    renderPage({ lists: [[B_ZED_NEW, B_ADA]] })
    await screen.findByText('Zed new burden')
    const r = within(screen.getByRole('article', { name: 'Zed Zimmer' }))
    expect(r.getByRole('link', { name: 'Zed Zimmer' })).toHaveAttribute('href', '/people/p-zed')
    expect(r.getByText('Active')).toBeInTheDocument()
    expect(r.getByText('Added 1 week ago')).toBeInTheDocument()
    expect(r.getByText(lineText('You, 2 days ago: Spoke on Sunday'))).toBeInTheDocument()
    expect(r.queryByText(/Older note/)).not.toBeInTheDocument()

    const ada = within(screen.getByRole('article', { name: 'Ada Adams' }))
    expect(ada.getByText('New contact')).toBeInTheDocument()
    expect(ada.getByText('Added 6 weeks ago')).toBeInTheDocument()
    expect(ada.getByText(lineText('Olivia Other, 1 day ago: Prayed together'))).toBeInTheDocument()
  })

  it('shows the other status names', async () => {
    renderPage({
      lists: [
        [
          burden('x1', 'Inactive one', ago(1), 'p-i', 'Ina', { status: STATUS.inactive }),
          burden('x2', 'Lost one', ago(2), 'p-l', 'Lou', { status: STATUS.lost }),
        ],
      ],
    })
    await screen.findByText('Inactive one')
    expect(within(row('Inactive one')).getByText('Inactive')).toBeInTheDocument()
    expect(within(row('Lost one')).getByText('Lost contact')).toBeInTheDocument()
  })

  it('shows no comment line and a bare Comment link for a burden with no comments', async () => {
    renderPage({ lists: [[B_ZED_OLD]] })
    await screen.findByText('Zed old burden')
    const r = within(row('Zed old burden'))
    expect(r.queryByText(/ago:/)).not.toBeInTheDocument()
    const link = r.getByRole('link', { name: commentName('Zed Zimmer') })
    expect(link).toHaveAttribute('href', '/people/p-zed')
    expect(link).not.toHaveAttribute('aria-label')
    expect(link).not.toHaveTextContent('(')
    expect(r.getByRole('button', { name: 'Release prayer burden for Zed Zimmer' })).toBeVisible()
  })

  it('shows the comment count on the Comment link', async () => {
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    const link = within(row('Zed new burden')).getByRole('link', {
      name: commentName('Zed Zimmer', '2'),
    })
    expect(link).toHaveAttribute('href', '/people/p-zed')
    expect(link).not.toHaveAttribute('aria-label')
    expect(link).toHaveTextContent('(2)')
  })

  it('renders one list of rows', async () => {
    renderPage({ lists: [[B_ZED_NEW, B_ZED_OLD, B_ADA]] })
    await screen.findByText('Ada burden')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    // One set of rows serves every width: the same articles are not rendered twice.
    expect(screen.getAllByRole('link', { name: 'Zed Zimmer' })).toHaveLength(2)
  })

  it('navigates to the person from the name link', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW]] })
    await user.click(await screen.findByRole('link', { name: 'Zed Zimmer' }))
    expect(await screen.findByText('Person stub p-zed')).toBeInTheDocument()
  })
})

describe('Prayer list page sort and filter', () => {
  it('defaults to longest standing', async () => {
    renderPage({ lists: [[B_ZED_NEW, B_ADA, B_ZED_OLD]] })
    await screen.findByText('Ada burden')
    const sort = screen.getByRole('group', { name: 'Sort' })
    expect(within(sort).getByRole('button', { name: /^Longest\s*standing$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(sort).getByRole('button', { name: 'Newest' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(order(ALL)).toEqual(['Zed old burden', 'Ada burden', 'Zed new burden'])
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  it('sorts newest first', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_OLD, B_ADA, B_ZED_NEW]] })
    await screen.findByText('Ada burden')
    await user.click(screen.getByRole('button', { name: 'Newest' }))
    expect(screen.getByRole('button', { name: 'Newest' })).toHaveAttribute('aria-pressed', 'true')
    expect(order(ALL)).toEqual(['Zed new burden', 'Ada burden', 'Zed old burden'])
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  it('breaks createdAt ties by id ascending in both orders', async () => {
    const user = userEvent.setup()
    const t = ago(5)
    renderPage({
      lists: [
        [burden('b-z', 'Tie zed', t, 'p-1', 'Pat'), burden('b-a', 'Tie ada', t, 'p-2', 'Quin')],
      ],
    })
    await screen.findByText('Tie zed')
    const tie = ['Tie zed', 'Tie ada']
    expect(order(tie)).toEqual(['Tie ada', 'Tie zed'])
    await user.click(screen.getByRole('button', { name: 'Newest' }))
    expect(order(tie)).toEqual(['Tie ada', 'Tie zed'])
  })

  it('groups by person, A to Z, oldest first within a person', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW, B_ADA, B_ZED_OLD]] })
    await screen.findByText('Ada burden')
    await user.click(screen.getByRole('button', { name: 'By person' }))
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Ada Adams',
      'Zed Zimmer',
    ])
    expect(order(ALL)).toEqual(['Ada burden', 'Zed old burden', 'Zed new burden'])
  })

  it('lists people with burdens A to Z in the filter, and filters rows and summary', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW, B_ADA, B_ZED_OLD]] })
    await screen.findByText('Ada burden')
    const select = screen.getByRole('combobox', { name: 'Filter by person' })
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => [o.textContent, o.value])).toEqual([
      ['Everyone', ''],
      ['Ada Adams', 'p-ada'],
      ['Zed Zimmer', 'p-zed'],
    ])

    await user.selectOptions(select, 'p-zed')
    expect(screen.queryByText('Ada burden')).not.toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByText('2 active burdens')).toBeInTheDocument()

    await user.selectOptions(select, '')
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('shows the empty box when the filtered person has no burdens left', async () => {
    const user = userEvent.setup()
    renderPage({
      lists: [[B_ADA, B_ZED_OLD], [B_ZED_OLD]],
      extra: [releaseMutation('b3', B_ADA)],
    })
    await screen.findByText('Ada burden')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by person' }), 'p-ada')
    await user.click(screen.getByRole('button', { name: 'Release prayer burden for Ada Adams' }))
    expect(
      await screen.findByText('No active prayer burdens here. Add one when something comes up.'),
    ).toBeInTheDocument()
  })
})

describe('Prayer list page release', () => {
  it('removes the row at once, toasts with Undo, and Undo brings it back', async () => {
    const user = userEvent.setup()
    const undone = vi.fn(() => ({ data: { unreleasePrayerBurden: B_ADA } }))
    const { listCalls } = renderPage({
      lists: [[B_ADA, B_ZED_OLD], [B_ZED_OLD], [B_ADA, B_ZED_OLD]],
      extra: [
        releaseMutation('b3', B_ADA, { delay: 100 }),
        {
          request: { query: G.UnreleasePrayerBurdenDocument, variables: { id: 'b3' } },
          result: undone,
        },
      ],
    })
    await screen.findByText('Ada burden')
    await user.click(screen.getByRole('button', { name: 'Release prayer burden for Ada Adams' }))
    // Gone before the mutation resolves.
    expect(screen.queryByText('Ada burden')).not.toBeInTheDocument()

    const toast = await screen.findByRole('status')
    await waitFor(() => expect(toast).toHaveTextContent('Released prayer burden for Ada'))
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Ada burden')).not.toBeInTheDocument()

    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undone).toHaveBeenCalled())
    expect(await screen.findByText('Ada burden')).toBeInTheDocument()
  })

  it('restores the row and shows the friendly message when release is forbidden', async () => {
    const user = userEvent.setup()
    renderPage({
      lists: [[B_ADA]],
      extra: [releaseMutation('b3', B_ADA, { error: 'FORBIDDEN' })],
    })
    await screen.findByText('Ada burden')
    await user.click(screen.getByRole('button', { name: 'Release prayer burden for Ada Adams' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(FRIENDLY)).toBeInTheDocument()
    expect(screen.getByText('Ada burden')).toBeInTheDocument()
    expect(screen.queryByText(/Released prayer burden/)).not.toBeInTheDocument()
  })

  it('shows the server message for a BAD_USER_INPUT release failure', async () => {
    const user = userEvent.setup()
    renderPage({
      lists: [[B_ADA]],
      extra: [releaseMutation('b3', B_ADA, { error: 'BAD_USER_INPUT' })],
    })
    await screen.findByText('Ada burden')
    await user.click(screen.getByRole('button', { name: 'Release prayer burden for Ada Adams' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Already released')
    expect(screen.getByText('Ada burden')).toBeInTheDocument()
  })

  it('explains a NOT_FOUND undo and refetches the list', async () => {
    const user = userEvent.setup()
    const { listCalls } = renderPage({
      lists: [[B_ADA, B_ZED_OLD], [B_ZED_OLD]],
      extra: [releaseMutation('b3', B_ADA), unreleaseMutation('b3', B_ADA, 'NOT_FOUND')],
    })
    await screen.findByText('Ada burden')
    await user.click(screen.getByRole('button', { name: 'Release prayer burden for Ada Adams' }))
    const toast = await screen.findByRole('status')
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2))
    const before = listCalls.mock.calls.length
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(
      await screen.findByText("Couldn't undo. This was changed or removed by someone else."),
    ).toBeInTheDocument()
    await waitFor(() => expect(listCalls.mock.calls.length).toBeGreaterThan(before))
  })
})

describe('Prayer list page accessibility', () => {
  it('has no axe violations with rows', async () => {
    const { container } = renderPage({ lists: [[B_ZED_NEW, B_ZED_OLD, B_ADA]] })
    await screen.findByText('Ada burden')
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

describe('Header navigation', () => {
  it('links to Home, My people and Prayer list', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'My people' })).toHaveAttribute('href', '/people')
    expect(screen.getByRole('link', { name: 'Prayer list' })).toHaveAttribute('href', '/prayer')
  })

  it('marks only the current page link with aria-current', async () => {
    renderPage()
    const prayer = await screen.findByRole('link', { name: 'Prayer list' })
    expect(prayer).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'My people' })).not.toHaveAttribute('aria-current')
  })
})
