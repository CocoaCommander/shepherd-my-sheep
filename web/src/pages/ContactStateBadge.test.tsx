import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactState } from '../generated/graphql'
import { ContactStateBadge } from './ContactStateBadge'

const HOUR = 3_600_000
const NOW = new Date(2026, 9, 15, 14, 0, 0)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const ACTIVE = { name: 'active' }
const NEW = { name: 'new contact' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('ContactStateBadge', () => {
  it('says the follow-up is overdue for a new contact', () => {
    render(
      <ContactStateBadge
        person={{ status: NEW, contactState: ContactState.Overdue, contactDueAt: at(-50 * HOUR) }}
      />,
    )
    expect(screen.getByText('Follow-up overdue')).toBeInTheDocument()
  })

  it('says how long an active person is overdue', () => {
    render(
      <ContactStateBadge
        person={{
          status: ACTIVE,
          contactState: ContactState.Overdue,
          contactDueAt: at(-50 * HOUR),
        }}
      />,
    )
    expect(screen.getByText('Overdue · 2 days')).toBeInTheDocument()
  })

  it('counts down for a new contact who is due soon', () => {
    render(
      <ContactStateBadge
        person={{ status: NEW, contactState: ContactState.DueSoon, contactDueAt: at(5 * HOUR) }}
      />,
    )
    expect(screen.getByText('Due in 5 hours')).toBeInTheDocument()
  })

  it('renders nothing for someone not tracked', () => {
    const { container } = render(
      <ContactStateBadge
        person={{ status: { name: 'inactive' }, contactState: ContactState.NotTracked }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
