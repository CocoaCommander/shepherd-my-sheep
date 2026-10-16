import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BoardColumn } from '../BoardColumn/BoardColumn'
import styles from '../BoardColumn/BoardColumn.module.css'
import { MiniPersonCard } from '../PersonCard/PersonCard'

describe('BoardColumn', () => {
  it('titles the column by status with a count and holds cards', () => {
    render(
      <BoardColumn status="active" count={1}>
        <MiniPersonCard name="Elena Petrova" prayerCount={1} milestones={['Small group']} />
      </BoardColumn>,
    )
    const heading = screen.getByRole('heading', { name: 'Active' })
    const dot = heading.querySelector(`.${styles.dot}`)
    expect(dot).toHaveClass(styles.active)
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    const column = heading.closest('section')!
    expect(column).toHaveTextContent('1')
    expect(within(column).getAllByRole('article')).toHaveLength(1)
  })

  it('renders empty (business rule 1)', () => {
    render(<BoardColumn status="lost" count={0} />)
    const heading = screen.getByRole('heading', { name: 'Lost contact' })
    const column = heading.closest('section')!
    expect(within(column).queryByRole('article')).not.toBeInTheDocument()
    expect(column).toHaveTextContent('0')
  })

  it('defaults to h2 and accepts another heading level', () => {
    const { rerender } = render(<BoardColumn status="active" count={0} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Active' })).toBeInTheDocument()
    rerender(<BoardColumn status="active" count={0} headingLevel={3} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Active' })).toBeInTheDocument()
  })

  it('accepts a custom title', () => {
    render(<BoardColumn status="new" title="Just met" count={2} />)
    expect(screen.getByRole('heading', { name: 'Just met' })).toBeInTheDocument()
  })
})
