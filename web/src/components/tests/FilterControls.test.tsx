import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Chip, SegmentedControl, Switch, ViewToggle } from '../FilterControls/FilterControls'

describe('Chip', () => {
  it('exposes its pressed state and count', async () => {
    const onClick = vi.fn()
    render(
      <Chip pressed={false} count={2} onClick={onClick}>
        New contact
      </Chip>,
    )
    const chip = screen.getByRole('button', { name: 'New contact 2', pressed: false })
    await userEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is pressed when selected', () => {
    render(<Chip pressed>All</Chip>)
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toHaveAttribute(
      'type',
      'button',
    )
  })
})

describe('SegmentedControl', () => {
  const options = [
    { value: 'name', label: 'Name' },
    { value: 'date', label: 'Date' },
  ] as const

  it('presses exactly the selected segment and reports changes', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl label="Sort" options={[...options]} value="name" onChange={onChange} />,
    )
    expect(screen.getByRole('group', { name: 'Sort' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Name', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Date', pressed: false })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Date' }))
    expect(onChange).toHaveBeenCalledWith('date')
  })
})

describe('ViewToggle', () => {
  it('labels its icon buttons and reports the chosen view', async () => {
    const onChange = vi.fn()
    render(<ViewToggle value="gallery" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Gallery view', pressed: true })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'List view', pressed: false }))
    expect(onChange).toHaveBeenCalledWith('list')
  })
})

describe('Switch', () => {
  it('is a switch that reports the toggled value', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <Switch checked={false} onChange={onChange}>
        Hide details
      </Switch>,
    )
    const toggle = screen.getByRole('switch', { name: 'Hide details' })
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(
      <Switch checked onChange={onChange}>
        Hide details
      </Switch>,
    )
    expect(screen.getByRole('switch', { name: 'Hide details' })).toBeChecked()
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })
})
