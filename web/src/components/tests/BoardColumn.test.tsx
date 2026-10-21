import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('is a region named by its title', () => {
    render(<BoardColumn status="inactive" count={0} />)
    expect(screen.getByRole('region', { name: 'Inactive' })).toBeInTheDocument()
  })

  it('shows the rule under the title', () => {
    render(<BoardColumn status="active" count={1} rule="Contact at least every 7 days" />)
    expect(screen.getByText('Contact at least every 7 days')).toHaveClass(styles.rule)
  })

  it('shows the empty text only when the count is 0', () => {
    const { rerender } = render(<BoardColumn status="lost" count={0} empty="Drop someone here" />)
    expect(screen.getByText('Drop someone here')).toHaveClass(styles.empty)
    rerender(
      <BoardColumn status="lost" count={1} empty="Drop someone here">
        <MiniPersonCard name="Ann Lee" prayerCount={0} milestones={[]} />
      </BoardColumn>,
    )
    expect(screen.queryByText('Drop someone here')).not.toBeInTheDocument()
  })

  it('highlights the column while dropActive', () => {
    const { rerender } = render(<BoardColumn status="active" count={0} />)
    const column = screen.getByRole('region', { name: 'Active' })
    expect(column).not.toHaveClass(styles.dropActive)
    rerender(<BoardColumn status="active" count={0} dropActive />)
    expect(column).toHaveClass(styles.dropActive)
  })

  it('passes drop handlers and other props to the section', () => {
    const onDragOver = vi.fn()
    const onDrop = vi.fn()
    render(
      <BoardColumn
        status="active"
        count={0}
        onDragOver={onDragOver}
        onDrop={onDrop}
        data-testid="col"
        className="extra"
      />,
    )
    const column = screen.getByTestId('col')
    expect(column.tagName).toBe('SECTION')
    expect(column).toHaveClass(styles.column, 'extra')
    fireEvent.dragOver(column)
    fireEvent.drop(column)
    expect(onDragOver).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it('accepts a custom title', () => {
    render(<BoardColumn status="new" title="Just met" count={2} />)
    expect(screen.getByRole('heading', { name: 'Just met' })).toBeInTheDocument()
  })
})
