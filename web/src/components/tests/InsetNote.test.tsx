import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InsetNote, MilestoneTag, PrayerCount } from '../InsetNote/InsetNote'
import styles from '../InsetNote/InsetNote.module.css'

describe('InsetNote', () => {
  it('shows a label above its content', () => {
    render(<InsetNote label="Last note, 3 weeks ago">Text her.</InsetNote>)
    expect(screen.getByText('Last note, 3 weeks ago')).toHaveClass(styles.label)
    expect(screen.getByText('Text her.')).toHaveClass(styles.inset)
  })
})

describe('MilestoneTag', () => {
  it('is dashed with no check when not recorded', () => {
    render(<MilestoneTag>Baptised</MilestoneTag>)
    const tag = screen.getByText('Baptised')
    expect(tag).not.toHaveClass(styles.done)
    expect(tag.querySelector('svg')).not.toBeInTheDocument()
  })

  it('has a check when recorded', () => {
    render(<MilestoneTag done>Serving</MilestoneTag>)
    const tag = screen.getByText('Serving')
    expect(tag).toHaveClass(styles.done)
    expect(tag.querySelector('svg')).toBeInTheDocument()
  })
})

describe('PrayerCount', () => {
  it('shows the count', () => {
    render(<PrayerCount count={2} />)
    expect(screen.getByText('2')).not.toHaveClass(styles.prayNone)
  })

  it('is muted at zero (business rule 3)', () => {
    render(<PrayerCount count={0}>0 praying</PrayerCount>)
    expect(screen.getByText('0 praying')).toHaveClass(styles.prayNone)
  })

  it('adds a suffix for screen readers only', () => {
    render(<PrayerCount count={1} hiddenSuffix=" praying" />)
    expect(screen.getByText('praying')).toBeInTheDocument()
  })
})
