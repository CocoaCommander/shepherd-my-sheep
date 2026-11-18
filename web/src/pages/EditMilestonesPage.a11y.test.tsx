import { MockedProvider } from '@apollo/client/testing'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as G from '../generated/graphql'
import { EditMilestonesPage } from './EditMilestonesPage'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ isSignedIn: true, signIn: () => {}, signOut: () => {} }),
}))

const ME = { __typename: 'User', id: 'user-me', name: 'Me Shepherd', username: 'me' }

const LIST = [
  {
    __typename: 'Milestone',
    id: 'ms-b',
    name: 'baptised',
    description: 'Was baptised',
    recordedCount: 1,
  },
  {
    __typename: 'Milestone',
    id: 'ms-g',
    name: 'joined small group',
    description: null,
    recordedCount: 0,
  },
  {
    __typename: 'Milestone',
    id: 'ms-s',
    name: 'serving',
    description: 'Serves',
    recordedCount: 12,
  },
]

async function violations(
  milestones: typeof LIST,
  before?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>,
) {
  const user = userEvent.setup()
  const forever = { maxUsageCount: Number.POSITIVE_INFINITY }
  const { container } = render(
    <MockedProvider
      mocks={[
        { request: { query: G.MilestonesDocument }, result: { data: { milestones } }, ...forever },
        { request: { query: G.MeDocument }, result: { data: { me: ME } }, ...forever },
      ]}
    >
      <MemoryRouter initialEntries={['/milestones/edit']}>
        <Routes>
          <Route path="/milestones/edit" element={<EditMilestonesPage />} />
        </Routes>
      </MemoryRouter>
    </MockedProvider>,
  )
  await screen.findByRole('button', { name: 'Add milestone' })
  await screen.findByRole('heading', { level: 2, name: /^\d+ milestones?$/ })
  await before?.(user)
  const results = await axe.run(container.ownerDocument.body, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)
}

describe('Edit milestones page accessibility (axe-core, WCAG 2.2 A/AA)', () => {
  it('with milestones listed', async () => {
    expect(await violations(LIST)).toEqual([])
  })

  it('with no milestones (empty state)', async () => {
    expect(await violations([])).toEqual([])
  })

  it('with an inline edit form open', async () => {
    expect(
      await violations(LIST, async (user) => {
        await user.click(screen.getByRole('button', { name: 'Edit baptised' }))
        await screen.findByRole('form', { name: 'Edit baptised' })
      }),
    ).toEqual([])
  })

  it('with add-form errors showing', async () => {
    expect(
      await violations(LIST, async (user) => {
        await user.click(screen.getByRole('button', { name: 'Add milestone' }))
        await screen.findByText('Enter a name for the milestone.')
      }),
    ).toEqual([])
  })

  it('with the delete dialog open, for a milestone with records', async () => {
    expect(
      await violations(LIST, async (user) => {
        await user.click(screen.getByRole('button', { name: 'Delete serving' }))
        await screen.findByRole('alertdialog')
      }),
    ).toEqual([])
  })

  it('with the delete dialog open, for a milestone nobody has recorded', async () => {
    expect(
      await violations(LIST, async (user) => {
        await user.click(screen.getByRole('button', { name: 'Delete joined small group' }))
        await screen.findByRole('alertdialog')
      }),
    ).toEqual([])
  })
})
