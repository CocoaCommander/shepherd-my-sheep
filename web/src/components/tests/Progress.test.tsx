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
  const steps = ['baptised', 'Hosting a group', 'leading', 'serving', 'small group']

  it('marks recorded milestones in the given order and names them verbatim', () => {
    render(<Milestones steps={steps} recorded={['serving', 'baptised', 'leading']} />)
    const bar = screen.getByRole('img', { name: 'Milestones: 3 of 5: baptised, leading, serving' })
    const segments = Array.from(bar.children)
    expect(segments).toHaveLength(5)
    expect(segments.map((s) => s.classList.contains(styles.on))).toEqual([
      true,
      false,
      true,
      true,
      false,
    ])
    expect(screen.getByText('3 of 5: baptised, leading, serving')).toBeInTheDocument()
  })

  it('renders a person with no milestones (business rule 2)', () => {
    render(<Milestones steps={steps} recorded={[]} />)
    const bar = screen.getByRole('img', { name: 'Milestones: No milestones yet' })
    expect(bar.querySelectorAll(`.${styles.on}`)).toHaveLength(0)
    expect(screen.getByText('No milestones yet')).toBeInTheDocument()
  })

  it('ignores recorded names that are not in the list', () => {
    render(<Milestones steps={steps} recorded={['Unknown']} />)
    expect(screen.getByRole('img', { name: 'Milestones: No milestones yet' })).toBeInTheDocument()
  })

  it('draws no bar and says so when no milestones are set up (business rule 7)', () => {
    render(<Milestones steps={[]} recorded={[]} />)
    expect(screen.getByText('No milestones set up')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders nothing in the compact bar when no milestones are set up', () => {
    const { container } = render(<Milestones steps={[]} recorded={[]} compact />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides the caption in the compact bar', () => {
    const { container } = render(<Milestones steps={steps} recorded={['baptised']} compact />)
    expect(container.firstElementChild).toHaveClass(styles.compact)
    expect(screen.queryByText('1 of 5: baptised')).not.toBeInTheDocument()
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

  it('colours each step by its outcome and counts them in the name', () => {
    render(<Stepper current={3} total={4} outcomes={['logged', 'skipped', undefined, undefined]} />)
    const stepper = screen.getByRole('img', { name: 'Step 3 of 4. 1 logged, 1 skipped.' })
    expect(Array.from(stepper.children).map((s) => s.className.split(' ')[1] ?? '')).toEqual([
      styles.logged,
      styles.skipped,
      styles.on,
      '',
    ])
  })
})
