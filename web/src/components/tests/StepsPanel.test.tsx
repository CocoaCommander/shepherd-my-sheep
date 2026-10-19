import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StepsPanel } from '../StepsPanel/StepsPanel'

describe('StepsPanel', () => {
  it('is a section named by its heading, with the steps in order', () => {
    render(<StepsPanel items={['Log a contact.', 'They move to Active.', 'Contact weekly.']} />)
    const panel = screen.getByRole('region', { name: 'What happens next' })
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('What happens next')
    const steps = within(panel).getAllByRole('listitem')
    expect(steps.map((s) => s.textContent)).toEqual([
      'Log a contact.',
      'They move to Active.',
      'Contact weekly.',
    ])
    expect(steps[0].parentElement?.tagName).toBe('OL')
  })

  it('takes its own heading and level', () => {
    render(<StepsPanel heading="Next" headingLevel={3} items={['One.']} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Next' })).toBeInTheDocument()
  })
})
