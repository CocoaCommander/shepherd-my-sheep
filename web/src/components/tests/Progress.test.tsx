import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Meter, meterPercent, Milestones, Stepper } from '../Progress/Progress'
import styles from '../Progress/Progress.module.css'

describe('meterPercent', () => {
  it.each([
    [3, 7, (3 / 7) * 100],
    [7, 7, 100],
    [21, 7, 100],
    [0, 7, 0],
    [-2, 7, 0],
    [5, 0, 0],
  ])('%d of %d → %d%%', (value, max, expected) => {
    expect(meterPercent(value, max)).toBeCloseTo(expected)
  })
})

describe('Meter', () => {
  it('shows the label and goal in words and as the image label', () => {
    render(<Meter value={3} max={7} label="3 days since last contact" goal="Goal: every 7 days" />)
    expect(screen.getByText('3 days since last contact')).toBeInTheDocument()
    expect(screen.getByText('Goal: every 7 days')).toBeInTheDocument()
    const bar = screen.getByRole('img', { name: '3 days since last contact. Goal: every 7 days' })
    expect(bar.firstElementChild).toHaveStyle({ width: `${(3 / 7) * 100}%` })
  })

  it('caps the fill at 100% when overdue', () => {
    render(<Meter value={21} max={7} tone="danger" label="21 days" />)
    const bar = screen.getByRole('img', { name: '21 days' })
    expect(bar.firstElementChild).toHaveStyle({ width: '100%' })
    expect(bar.parentElement).toHaveClass(styles.danger)
  })

  it('uses the warn tone for coming up', () => {
    render(<Meter value={48} max={72} tone="warn" label="Contacted 48 hours ago" />)
    expect(screen.getByRole('img').parentElement).toHaveClass(styles.warn)
  })
})

describe('Milestones', () => {
  it('marks recorded milestones in the fixed order and names them', () => {
    render(<Milestones recorded={['Leading', 'Baptised', 'Serving']} />)
    const bar = screen.getByRole('img', { name: 'Milestones: 3 of 4: Baptised, Serving, Leading' })
    const segments = Array.from(bar.children)
    expect(segments.map((s) => s.classList.contains(styles.on))).toEqual([true, false, true, true])
    expect(screen.getByText('3 of 4: Baptised, Serving, Leading')).toBeInTheDocument()
  })

  it('renders a person with no milestones (business rule 2)', () => {
    render(<Milestones recorded={[]} />)
    const bar = screen.getByRole('img', { name: 'Milestones: No milestones yet' })
    expect(bar.querySelectorAll(`.${styles.on}`)).toHaveLength(0)
    expect(screen.getByText('No milestones yet')).toBeInTheDocument()
  })

  it('ignores names that are not milestones', () => {
    render(<Milestones recorded={['Unknown']} />)
    expect(screen.getByRole('img', { name: 'Milestones: No milestones yet' })).toBeInTheDocument()
  })

  it('hides the caption in the compact bar', () => {
    const { container } = render(<Milestones recorded={['Baptised']} compact />)
    expect(container.firstElementChild).toHaveClass(styles.compact)
    expect(screen.queryByText('1 of 4: Baptised')).not.toBeInTheDocument()
  })
})

describe('Stepper', () => {
  it('marks the visited steps', () => {
    render(<Stepper current={2} total={4} />)
    const stepper = screen.getByRole('img', { name: 'Step 2 of 4' })
    const segments = Array.from(stepper.children)
    expect(segments).toHaveLength(4)
    expect(segments.map((s) => s.classList.contains(styles.on))).toEqual([true, true, false, false])
  })
})
