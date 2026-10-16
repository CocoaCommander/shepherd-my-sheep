import { render, screen } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { StatTile } from '../StatTile/StatTile'
import styles from '../StatTile/StatTile.module.css'

describe('StatTile', () => {
  it('is a link with the number, label and rule', () => {
    render(<StatTile href="#overdue" tone="danger" count={4} label="Overdue" rule="Alert raised" />)
    const link = screen.getByRole('link', { name: '4 Overdue Alert raised' })
    expect(link).toHaveAttribute('href', '#overdue')
    expect(link).toHaveClass(styles.stat, styles.danger)
  })

  it('is plain surface when not tracked', () => {
    render(<StatTile href="#" count={3} label="Not tracked" rule="Inactive or lost" />)
    const link = screen.getByRole('link')
    for (const tone of ['danger', 'warn', 'ok']) expect(link).not.toHaveClass(styles[tone])
  })

  it('shows zero', () => {
    render(<StatTile href="#" tone="ok" count={0} label="On track" rule="Within window" />)
    expect(screen.getByRole('link', { name: '0 On track Within window' })).toBeInTheDocument()
  })

  it('renders as a router link', () => {
    render(
      <MemoryRouter>
        <StatTile
          as={Link}
          to="/?filter=soon"
          tone="warn"
          count={3}
          label="Coming up"
          rule="Due within 2 days"
        />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/?filter=soon')
    expect(link).toHaveClass(styles.warn)
  })
})
