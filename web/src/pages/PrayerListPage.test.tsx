import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { GraphQLError } from 'graphql'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  /** Result of RecentlyReleasedPrayerBurdens; repeats. */
  released?: object[]
  extra?: MockedResponse[]
}

function renderPage({
  lists = [[]],
  people = [PERSON_SUMMARY],
  released = [],
  extra = [],
}: Setup = {}) {
  const listCalls = vi.fn()
  const releasedCalls = vi.fn()
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
      request: { query: G.RecentlyReleasedPrayerBurdensDocument },
      result: () => {
        releasedCalls()
        return { data: { recentlyReleasedPrayerBurdens: released } }
      },
      maxUsageCount: forever,
    },
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
  return { ...utils, listCalls, releasedCalls }
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

  it('shows no comment line and a bare Comment button for a burden with no comments', async () => {
    renderPage({ lists: [[B_ZED_OLD]] })
    await screen.findByText('Zed old burden')
    const r = within(row('Zed old burden'))
    expect(r.queryByText(/ago:/)).not.toBeInTheDocument()
    const button = r.getByRole('button', { name: commentName('Zed Zimmer') })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-label')
    expect(button).not.toHaveTextContent('(')
    expect(r.getByRole('button', { name: 'Release prayer burden for Zed Zimmer' })).toBeVisible()
  })

  it('shows the comment count on the Comment button', async () => {
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    const button = within(row('Zed new burden')).getByRole('button', {
      name: commentName('Zed Zimmer', '2'),
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-label')
    expect(button).toHaveTextContent('(2)')
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

// Newest first, as the API returns them: m5 is the newest, m1 the oldest.
const B_MANY = burden('b9', 'Many comments burden', ago(20), 'p-many', 'Mia Many', {
  comments: [
    comment('m5', 'Fifth note', ago(1), { ...OTHER }),
    comment('m4', 'Fourth note', ago(2), { __typename: 'User', id: ME.id, name: ME.name }),
    comment('m3', 'Third note', ago(3), { ...OTHER }),
    comment('m2', 'Second note', ago(4), { ...OTHER }),
    comment('m1', 'First note', ago(5), { ...OTHER }),
  ],
})
const B_THREE = burden('b8', 'Three comments burden', ago(20), 'p-three', 'Theo Three', {
  comments: [
    comment('t3', 'Third note', ago(1), { ...OTHER }),
    comment('t2', 'Second note', ago(2), { ...OTHER }),
    comment('t1', 'First note', ago(3), { ...OTHER }),
  ],
})
const B_YEAR = burden('b7', 'Year old burden', ago(400), 'p-year', 'Yara Year')
const B_RELEASED = {
  ...burden('r1', 'Released burden', ago(60), 'p-rel', 'Rhea Released', {
    comments: [
      comment('rc2', 'Newest release note', ago(4), { ...OTHER }),
      comment('rc1', 'Older release note', ago(9), { ...OTHER }),
    ],
  }),
  releasedDate: ago(3),
}
const B_RELEASED_BARE = {
  ...burden('r2', 'Bare released burden', ago(60), 'p-bare', 'Bo Bare'),
  releasedDate: ago(5),
}

/** The Comment button of the only row for `person`. */
const commentButton = (person: string) =>
  screen.getByRole('button', { name: new RegExp(`^Comment\\s*on prayer burden for ${person}`) })
const COMMENT_BOX = { name: 'Add a comment on this burden' }

function createCommentMutation(
  personId: string,
  prayerBurdenId: string,
  content: string,
  opts: { error?: string } = {},
) {
  return {
    request: {
      query: G.CreateCommentDocument,
      variables: { input: { personId, prayerBurdenId, content } },
    },
    result: opts.error
      ? { errors: [new GraphQLError('boom', { extensions: { code: opts.error } })] }
      : { data: { createComment: { __typename: 'Comment', id: 'new-c' } } },
  } as MockedResponse
}

describe('Prayer list page comment thread', () => {
  it('opens and closes the thread from the Comment button', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    const button = commentButton('Zed Zimmer')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', COMMENT_BOX)).toBeNull()

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const thread = document.getElementById(button.getAttribute('aria-controls') as string)
    expect(thread).not.toBeNull()
    expect(within(thread as HTMLElement).getByRole('textbox', COMMENT_BOX)).toBeInTheDocument()

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', COMMENT_BOX)).toBeNull()
  })

  it('swaps the latest-comment inset for the thread while open', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    expect(screen.getByText(lineText('You, 2 days ago: Spoke on Sunday'))).toBeInTheDocument()
    await user.click(commentButton('Zed Zimmer'))
    expect(screen.queryByText(lineText('You, 2 days ago: Spoke on Sunday'))).toBeNull()
    // The thread still shows the comment.
    expect(screen.getByText('Spoke on Sunday')).toBeInTheDocument()
    await user.click(commentButton('Zed Zimmer'))
    expect(screen.getByText(lineText('You, 2 days ago: Spoke on Sunday'))).toBeInTheDocument()
  })

  it('shows author and time, oldest first, "You" for the signed-in user', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    await user.click(commentButton('Zed Zimmer'))
    const r = row('Zed new burden')
    expect(r).toHaveTextContent(/Olivia Other\s*·\s*1 week ago/)
    expect(r).toHaveTextContent(/You\s*·\s*2 days ago/)
    const text = r.textContent as string
    expect(text.indexOf('Older note')).toBeGreaterThan(-1)
    expect(text.indexOf('Older note')).toBeLessThan(text.indexOf('Spoke on Sunday'))
  })

  it('shows only the latest two comments and reveals earlier ones on request', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_MANY]] })
    await screen.findByText('Many comments burden')
    await user.click(commentButton('Mia Many'))
    const r = within(row('Many comments burden'))
    expect(r.getByText('Fourth note')).toBeInTheDocument()
    expect(r.getByText('Fifth note')).toBeInTheDocument()
    expect(r.queryByText('Third note')).toBeNull()

    await user.click(r.getByRole('button', { name: 'Show 3 earlier comments' }))
    const text = row('Many comments burden').textContent as string
    const at = ['First note', 'Second note', 'Third note', 'Fourth note', 'Fifth note'].map((c) =>
      text.indexOf(c),
    )
    expect(at.every((i) => i > -1)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)

    await user.click(r.getByRole('button', { name: 'Hide earlier comments' }))
    expect(r.queryByText('Third note')).toBeNull()
    expect(r.getByRole('button', { name: 'Show 3 earlier comments' })).toBeInTheDocument()
  })

  it('uses the singular for one earlier comment', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_THREE]] })
    await screen.findByText('Three comments burden')
    await user.click(commentButton('Theo Three'))
    const r = within(row('Three comments burden'))
    expect(r.queryByText('First note')).toBeNull()
    await user.click(r.getByRole('button', { name: 'Show 1 earlier comment' }))
    expect(r.getByText('First note')).toBeInTheDocument()
  })

  it('has no earlier-comments button with two or fewer comments', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    await user.click(commentButton('Zed Zimmer'))
    expect(screen.queryByRole('button', { name: /earlier comment/ })).toBeNull()
  })

  it('opens a zero-comment burden with only the comment box', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_OLD]] })
    await screen.findByText('Zed old burden')
    await user.click(commentButton('Zed Zimmer'))
    const r = within(row('Zed old burden'))
    expect(r.getByRole('textbox', COMMENT_BOX)).toBeInTheDocument()
    expect(r.getByRole('button', { name: 'Comment' })).toBeDisabled()
    expect(r.queryByRole('button', { name: /earlier comment/ })).toBeNull()
    expect(r.queryByText(/·/)).toBeNull()
  })

  it('disables Comment for blank text and sends nothing', async () => {
    const user = userEvent.setup()
    const sent = vi.fn()
    renderPage({
      lists: [[B_ZED_OLD]],
      extra: [
        {
          ...createCommentMutation('p-zed', 'b2', ''),
          result: () => {
            sent()
            return { data: { createComment: { __typename: 'Comment', id: 'x' } } }
          },
        },
      ],
    })
    await screen.findByText('Zed old burden')
    await user.click(commentButton('Zed Zimmer'))
    const box = screen.getByRole('textbox', COMMENT_BOX)
    const submit = screen.getByRole('button', { name: 'Comment' })
    expect(submit).toBeDisabled()
    await user.type(box, '   ')
    expect(submit).toBeDisabled()
    await user.type(box, 'hi')
    expect(submit).toBeEnabled()
    expect(sent).not.toHaveBeenCalled()
  })

  it('posts the trimmed comment, refetches, clears the box and keeps the thread open', async () => {
    const user = userEvent.setup()
    const after = comment('new-c', 'Checked in', ago(0), {
      __typename: 'User',
      id: ME.id,
      name: ME.name,
    })
    const { listCalls, releasedCalls } = renderPage({
      lists: [[B_ZED_OLD], [{ ...B_ZED_OLD, comments: [after] }]],
      extra: [createCommentMutation('p-zed', 'b2', 'Checked in')],
    })
    await screen.findByText('Zed old burden')
    await user.click(commentButton('Zed Zimmer'))
    await user.type(screen.getByRole('textbox', COMMENT_BOX), '  Checked in  ')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(releasedCalls).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Checked in')).toBeInTheDocument()
    expect(screen.getByRole('textbox', COMMENT_BOX)).toHaveValue('')
    expect(commentButton('Zed Zimmer')).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the friendly message in the thread and keeps the text on error', async () => {
    const user = userEvent.setup()
    renderPage({
      lists: [[B_ZED_OLD]],
      extra: [createCommentMutation('p-zed', 'b2', 'Checked in', { error: 'INTERNAL' })],
    })
    await screen.findByText('Zed old burden')
    await user.click(commentButton('Zed Zimmer'))
    await user.type(screen.getByRole('textbox', COMMENT_BOX), 'Checked in')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    const alert = await within(row('Zed old burden')).findByRole('alert')
    expect(alert).toHaveTextContent(FRIENDLY)
    expect(screen.getByRole('textbox', COMMENT_BOX)).toHaveValue('Checked in')
  })
})

const HIDE_KEY = 'shepherd.prayer.hideDetails'

describe('Prayer list page hide details', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('is off by default', async () => {
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    expect(screen.getByRole('switch', { name: 'Hide details' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.queryByText('Details hidden')).toBeNull()
  })

  it('hides burden text and the comment inset but keeps names, pills and counts', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW, B_ADA]] })
    await screen.findByText('Zed new burden')
    await user.click(screen.getByRole('switch', { name: 'Hide details' }))
    expect(screen.getByRole('switch', { name: 'Hide details' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.queryByText('Zed new burden')).toBeNull()
    expect(screen.queryByText('Ada burden')).toBeNull()
    expect(screen.queryByText(/Spoke on Sunday/)).toBeNull()
    expect(screen.queryByText(/Prayed together/)).toBeNull()
    expect(screen.getAllByText('Details hidden')).toHaveLength(2)
    const r = within(screen.getByRole('article', { name: 'Zed Zimmer' }))
    expect(r.getByRole('link', { name: 'Zed Zimmer' })).toBeInTheDocument()
    expect(r.getByText('Active')).toBeInTheDocument()
    expect(r.getByText('Added 1 week ago')).toBeInTheDocument()
    expect(r.getByRole('button', { name: commentName('Zed Zimmer', '2') })).toBeInTheDocument()
  })

  it('hides comment text in an open thread but keeps author and time', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    await user.click(screen.getByRole('switch', { name: 'Hide details' }))
    await user.click(commentButton('Zed Zimmer'))
    const article = screen.getByRole('article', { name: 'Zed Zimmer' })
    expect(article).toHaveTextContent(/You\s*·\s*2 days ago/)
    expect(article).toHaveTextContent(/Olivia Other\s*·\s*1 week ago/)
    expect(article.textContent).not.toMatch(/Spoke on Sunday|Older note/)
    // The burden and each of the two comments.
    expect(within(article).getAllByText('Details hidden')).toHaveLength(3)
  })

  it('starts on when localStorage says true', async () => {
    localStorage.setItem(HIDE_KEY, 'true')
    renderPage({ lists: [[B_ZED_NEW]] })
    expect(await screen.findByText('Details hidden')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Hide details' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.queryByText('Zed new burden')).toBeNull()
  })

  it('writes the setting when toggled', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ZED_NEW]] })
    await screen.findByText('Zed new burden')
    await user.click(screen.getByRole('switch', { name: 'Hide details' }))
    expect(localStorage.getItem(HIDE_KEY)).toBe('true')
    await user.click(screen.getByRole('switch', { name: 'Hide details' }))
    expect([null, 'false']).toContain(localStorage.getItem(HIDE_KEY))
    expect(screen.getByText('Zed new burden')).toBeInTheDocument()
  })

  it('falls back to off when reading localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    renderPage({ lists: [[B_ZED_NEW]] })
    expect(await screen.findByText('Zed new burden')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Hide details' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('hides details in the Recently released panel too', async () => {
    localStorage.setItem(HIDE_KEY, 'true')
    renderPage({ lists: [[]], released: [B_RELEASED] })
    const panel = await screen.findByRole('region', { name: 'Recently released' })
    expect(within(panel).getByText('Details hidden')).toBeInTheDocument()
    expect(within(panel).queryByText('Released burden')).toBeNull()
    expect(within(panel).queryByText('Newest release note')).toBeNull()
    expect(panel).toHaveTextContent(/Rhea Released\s*·\s*released 3 days ago/)
  })
})

describe('Prayer list page long-standing nudge', () => {
  it('shows the nudge only for burdens over a year old', async () => {
    renderPage({
      lists: [[B_YEAR, burden('b6', 'Recent enough', ago(300), 'p-rec', 'Rex Recent')]],
    })
    await screen.findByText('Year old burden')
    const nudge = 'On the list for over a year. Still the right one to carry?'
    expect(within(row('Year old burden')).getByText(nudge)).toBeInTheDocument()
    expect(within(row('Recent enough')).queryByText(/over a year/)).toBeNull()
    expect(screen.getAllByText(nudge)).toHaveLength(1)
  })
})

describe('Prayer list page recently released', () => {
  it('is not rendered when nothing was released', async () => {
    renderPage({ lists: [[B_ADA]], released: [] })
    await screen.findByText('Ada burden')
    expect(screen.queryByRole('heading', { name: 'Recently released' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Recently released' })).toBeNull()
  })

  it('lists each release with person, time, burden and newest comment', async () => {
    renderPage({ lists: [[B_ADA]], released: [B_RELEASED, B_RELEASED_BARE] })
    const panel = await screen.findByRole('region', { name: 'Recently released' })
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'Recently released' }),
    ).toBeInTheDocument()
    expect(panel).toHaveTextContent(/Rhea Released\s*·\s*released 3 days ago/)
    expect(within(panel).getByText('Released burden')).toBeInTheDocument()
    expect(within(panel).getByText('Newest release note')).toBeInTheDocument()
    expect(within(panel).queryByText('Older release note')).toBeNull()
    expect(panel).toHaveTextContent(/Bo Bare\s*·\s*released 5 days ago/)
    expect(within(panel).getByText('Bare released burden')).toBeInTheDocument()
  })

  it('has plain-text names and no buttons or links in the panel', async () => {
    renderPage({ lists: [[B_ADA]], released: [B_RELEASED, B_RELEASED_BARE] })
    const panel = await screen.findByRole('region', { name: 'Recently released' })
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(within(panel).queryByRole('link')).toBeNull()
  })

  it('does not show released entries as active rows', async () => {
    renderPage({ lists: [[B_ADA]], released: [B_RELEASED] })
    await screen.findByRole('region', { name: 'Recently released' })
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('refetches the panel after a release', async () => {
    const user = userEvent.setup()
    const { releasedCalls } = renderPage({
      lists: [[B_ADA], []],
      extra: [releaseMutation('b3', B_ADA)],
    })
    await screen.findByText('Ada burden')
    await waitFor(() => expect(releasedCalls).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Release prayer burden for Ada Adams' }))
    await waitFor(() => expect(releasedCalls).toHaveBeenCalledTimes(2))
  })
})

const P_ADA = PERSON_SUMMARY
const P_ZED = { ...PERSON_SUMMARY, id: 'p-zed', name: 'Zed Zimmer' }
const P_MIA = { ...PERSON_SUMMARY, id: 'p-mia', name: 'Mia Many' }
const HELP_ADA = 'Everyone who shepherds Ada sees prayer burdens and comments.'
const HELP_NONE = 'Everyone who shepherds this person sees prayer burdens and comments.'

function createPrayerBurdenMutation(
  personId: string,
  content: string,
  opts: { error?: string; result?: () => object } = {},
) {
  return {
    request: {
      query: G.CreatePrayerBurdenDocument,
      variables: { input: { personId, content } },
    },
    result:
      opts.result ??
      (opts.error
        ? { errors: [new GraphQLError('boom', { extensions: { code: opts.error } })] }
        : { data: { createPrayerBurden: { __typename: 'PrayerBurden', id: 'new-b' } } }),
  } as MockedResponse
}

const addButton = () => screen.getByRole('button', { name: 'Add prayer burden' })

async function openAddDialog(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(addButton()).toBeEnabled())
  await user.click(addButton())
  return screen.getByRole('dialog', { name: 'Add prayer burden' })
}

describe('Prayer list page add prayer burden', () => {
  it('disables the header button with zero people', async () => {
    renderPage({ people: [] })
    await screen.findByRole('heading', { level: 2, name: 'No one is assigned to you yet' })
    expect(addButton()).toBeDisabled()
  })

  it('disables the header button until people have loaded', () => {
    renderPage({ people: [P_ADA] })
    expect(addButton()).toBeDisabled()
  })

  it('opens a dialog listing people A to Z after "Choose a person"', async () => {
    const user = userEvent.setup()
    renderPage({ people: [P_ZED, P_ADA, P_MIA] })
    const dialog = await openAddDialog(user)
    const select = within(dialog).getByRole('combobox', { name: 'Person' })
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => [o.textContent, o.value])).toEqual([
      ['Choose a person', ''],
      ['Ada Adams', 'p-ada'],
      ['Mia Many', 'p-mia'],
      ['Zed Zimmer', 'p-zed'],
    ])
    expect(select).toHaveValue('')
    expect(within(dialog).getByRole('textbox', { name: 'Prayer burden' })).toBeInTheDocument()
  })

  it('preselects the only person', async () => {
    const user = userEvent.setup()
    renderPage({ people: [P_ADA] })
    const dialog = await openAddDialog(user)
    expect(within(dialog).getByRole('combobox', { name: 'Person' })).toHaveValue('p-ada')
  })

  it('preselects the person filter when set, even with several people', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ADA, B_ZED_OLD]], people: [P_ADA, P_ZED, P_MIA] })
    await screen.findByText('Ada burden')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by person' }), 'p-zed')
    const dialog = await openAddDialog(user)
    expect(within(dialog).getByRole('combobox', { name: 'Person' })).toHaveValue('p-zed')
  })

  it('preselects nobody with several people and no filter', async () => {
    const user = userEvent.setup()
    renderPage({ people: [P_ADA, P_ZED] })
    const dialog = await openAddDialog(user)
    expect(within(dialog).getByRole('combobox', { name: 'Person' })).toHaveValue('')
  })

  it('describes the textarea with the first name once a person is chosen', async () => {
    const user = userEvent.setup()
    renderPage({ people: [P_ADA, P_ZED] })
    const dialog = await openAddDialog(user)
    const box = within(dialog).getByRole('textbox', { name: 'Prayer burden' })
    expect(box).toHaveAccessibleDescription(HELP_NONE)
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Person' }), 'p-ada')
    expect(box).toHaveAccessibleDescription(HELP_ADA)
  })

  it('disables submit until a person is chosen and the trimmed text is non-empty', async () => {
    const user = userEvent.setup()
    renderPage({ people: [P_ADA, P_ZED] })
    const dialog = await openAddDialog(user)
    const submit = within(dialog).getByRole('button', { name: 'Add prayer burden' })
    const box = within(dialog).getByRole('textbox', { name: 'Prayer burden' })
    expect(submit).toBeDisabled()
    await user.type(box, 'Healing')
    expect(submit).toBeDisabled()
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Person' }), 'p-ada')
    expect(submit).toBeEnabled()
    await user.clear(box)
    await user.type(box, '   ')
    expect(submit).toBeDisabled()
  })

  it('Cancel closes the dialog and sends nothing', async () => {
    const user = userEvent.setup()
    const sent = vi.fn(() => ({
      data: { createPrayerBurden: { __typename: 'PrayerBurden', id: 'x' } },
    }))
    renderPage({
      people: [P_ADA],
      extra: [createPrayerBurdenMutation('p-ada', 'Healing', { result: sent })],
    })
    const dialog = await openAddDialog(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Prayer burden' }), 'Healing')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Add prayer burden' })).toBeNull()
    expect(sent).not.toHaveBeenCalled()
  })

  it('sends the trimmed burden, refetches, closes and toasts without Undo', async () => {
    const user = userEvent.setup()
    const sent = vi.fn(() => ({
      data: { createPrayerBurden: { __typename: 'PrayerBurden', id: 'new-b' } },
    }))
    const { listCalls, releasedCalls } = renderPage({
      lists: [[], [B_ADA]],
      people: [P_ADA],
      extra: [createPrayerBurdenMutation('p-ada', 'Healing', { result: sent })],
    })
    const dialog = await openAddDialog(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Prayer burden' }), '  Healing  ')
    await user.click(within(dialog).getByRole('button', { name: 'Add prayer burden' }))
    await waitFor(() => expect(sent).toHaveBeenCalled())
    await waitFor(() => expect(listCalls).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(releasedCalls).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add prayer burden' })).toBeNull(),
    )
    const toast = await screen.findByRole('status')
    expect(toast).toHaveTextContent('Added prayer burden for Ada')
    expect(within(toast).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('shows "Adding…" while busy', async () => {
    const user = userEvent.setup()
    renderPage({
      people: [P_ADA],
      extra: [{ ...createPrayerBurdenMutation('p-ada', 'Healing'), delay: 200 }],
    })
    const dialog = await openAddDialog(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Prayer burden' }), 'Healing')
    await user.click(within(dialog).getByRole('button', { name: 'Add prayer burden' }))
    expect(await within(dialog).findByRole('button', { name: 'Adding…' })).toBeDisabled()
  })

  it('stays open, keeps the text and shows the friendly message on error', async () => {
    const user = userEvent.setup()
    renderPage({
      people: [P_ADA],
      extra: [createPrayerBurdenMutation('p-ada', 'Healing', { error: 'INTERNAL' })],
    })
    const dialog = await openAddDialog(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Prayer burden' }), 'Healing')
    await user.click(within(dialog).getByRole('button', { name: 'Add prayer burden' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(FRIENDLY)
    expect(screen.getByRole('dialog', { name: 'Add prayer burden' })).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Prayer burden' })).toHaveValue('Healing')
  })
})

describe('Prayer list page comment form help', () => {
  it('links the sharing line to the comment input', async () => {
    const user = userEvent.setup()
    renderPage({ lists: [[B_ADA]] })
    await screen.findByText('Ada burden')
    await user.click(commentButton('Ada Adams'))
    const box = within(row('Ada burden')).getByRole('textbox', COMMENT_BOX)
    expect(box).toHaveAttribute('aria-describedby')
    expect(box).toHaveAccessibleDescription(HELP_ADA)
  })
})

describe('Prayer list page accessibility', () => {
  const audit = (container: HTMLElement) =>
    axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    })
  const summary = (results: Awaited<ReturnType<typeof audit>>) =>
    results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)

  afterEach(() => localStorage.clear())

  it('has no axe violations with rows', async () => {
    const { container } = renderPage({ lists: [[B_ZED_NEW, B_ZED_OLD, B_ADA]] })
    await screen.findByText('Ada burden')
    expect(summary(await audit(container))).toEqual([])
  })

  it('has no axe violations with an open thread, Hide details on and released entries', async () => {
    const user = userEvent.setup()
    const { container } = renderPage({
      lists: [[B_MANY, B_ZED_OLD, B_YEAR]],
      released: [B_RELEASED, B_RELEASED_BARE],
    })
    await screen.findByText('Many comments burden')
    await screen.findByRole('region', { name: 'Recently released' })
    await user.click(commentButton('Mia Many'))
    await user.click(screen.getByRole('button', { name: 'Show 3 earlier comments' }))
    expect(summary(await audit(container))).toEqual([])

    await user.click(screen.getByRole('switch', { name: 'Hide details' }))
    expect(summary(await audit(container))).toEqual([])
  })

  it('has no axe violations with the add prayer burden dialog open', async () => {
    const user = userEvent.setup()
    const { container } = renderPage({ lists: [[B_ADA]], people: [P_ADA, P_ZED] })
    await screen.findByText('Ada burden')
    await openAddDialog(user)
    expect(summary(await audit(container))).toEqual([])
    expect(summary(await audit(screen.getByRole('dialog')))).toEqual([])
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
