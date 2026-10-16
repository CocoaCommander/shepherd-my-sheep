import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CountPill, DueTag, StatusPill } from '../StatusPill/StatusPill'
import styles from '../StatusPill/StatusPill.module.css'

describe('StatusPill', () => {
  it.each([
    ['new', 'New contact'],
    ['active', 'Active'],
    ['inactive', 'Inactive'],
    ['lost', 'Lost contact'],
  ] as const)('shows the %s status word with its colour', (status, word) => {
    render(<StatusPill status={status} />)
    expect(screen.getByText(word)).toHaveClass(styles.pill, styles[status])
  })

  it('accepts custom text', () => {
    render(<StatusPill status="active">Regular</StatusPill>)
    expect(screen.getByText('Regular')).toHaveClass(styles.active)
  })
})

describe('DueTag', () => {
  it.each(['overdue', 'soon', 'ok'] as const)(
    'pairs the %s tone with an icon and words',
    (tone) => {
      render(<DueTag tone={tone}>Some words</DueTag>)
      const tag = screen.getByText('Some words')
      expect(tag).toHaveClass(styles.tag, styles[tone])
      expect(tag.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    },
  )
})

describe('CountPill', () => {
  it('shows the count, plain by default', () => {
    render(<CountPill count={11} />)
    const pill = screen.getByText('11')
    expect(pill).toHaveClass(styles.count)
    expect(pill).not.toHaveClass(styles.countDanger, styles.countWarn, styles.countOk)
  })

  it.each([
    ['danger', 'countDanger'],
    ['warn', 'countWarn'],
    ['ok', 'countOk'],
  ] as const)('follows the %s tone', (tone, cls) => {
    render(<CountPill count={4} tone={tone} />)
    expect(screen.getByText('4')).toHaveClass(styles[cls])
  })

  it('shows zero', () => {
    render(<CountPill count={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
