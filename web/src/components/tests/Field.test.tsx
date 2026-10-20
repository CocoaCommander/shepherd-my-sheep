import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DateField, PasswordField, SearchInput, Select, TextArea, TextField } from '../Field/Field'
import styles from '../Field/Field.module.css'

describe('TextField', () => {
  it('labels the input and describes it with the help line', () => {
    render(<TextField label="Username" help="Letters, numbers and dots." />)
    const input = screen.getByRole('textbox', { name: 'Username' })
    expect(input).toHaveAccessibleDescription('Letters, numbers and dots.')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('replaces the help with the error and marks the input invalid', () => {
    const { container } = render(
      <TextField label="Name" help="Your full name." error="Enter your name." />,
    )
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter your name.')
    expect(screen.queryByText('Your full name.')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass(styles.error)
  })

  it('has no description without help or error', () => {
    render(<TextField label="Name" />)
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby')
  })

  it('is a controlled input', async () => {
    function Controlled() {
      const [value, setValue] = useState('')
      return (
        <>
          <TextField label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
          <output>{value}</output>
        </>
      )
    }
    render(<Controlled />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Ada')
    expect(screen.getByRole('status')).toHaveTextContent('Ada')
  })

  it('keeps a caller-supplied id', () => {
    render(<TextField id="person-name" label="Name" />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('id', 'person-name')
  })
})

describe('required and optional', () => {
  it('says "required" in the label and sets aria-required, not native required', () => {
    render(<TextField label="Name" required />)
    const input = screen.getByRole('textbox', { name: 'Name (required)' })
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).not.toHaveAttribute('required')
  })

  it('says "optional" in the label', () => {
    render(<TextField label="Prayer burden" required={false} />)
    const input = screen.getByRole('textbox', { name: 'Prayer burden (optional)' })
    expect(input).not.toHaveAttribute('aria-required')
  })

  it('says neither when not given', () => {
    render(<TextField label="Name" />)
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-required')
  })
})

describe('error line', () => {
  it('is announced as an alert with an icon, and the help is not', () => {
    const { rerender } = render(<TextField label="Name" help="Your full name." />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    rerender(<TextField label="Name" help="Your full name." error="Enter a name." />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter a name.')
    expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Enter a name.')

    rerender(<TextField label="Name" help="Your full name." />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Your full name.')
  })
})

describe('TextArea', () => {
  it('shares the label, help, error and required wiring', async () => {
    const { container, rerender } = render(
      <TextArea label="Comment" required help="Saved as a note." placeholder="What about?" />,
    )
    const box = screen.getByRole('textbox', { name: 'Comment (required)' })
    expect(box.tagName).toBe('TEXTAREA')
    expect(box).toHaveAttribute('aria-required', 'true')
    expect(box).toHaveAccessibleDescription('Saved as a note.')
    await userEvent.type(box, 'Coffee{Enter}after church')
    expect(box).toHaveValue('Coffee\nafter church')

    rerender(<TextArea label="Comment" required error="Add a comment." />)
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Add a comment.')
    expect(container.firstElementChild).toHaveClass(styles.error)
  })
})

describe('DateField', () => {
  it('is a labelled date input that passes max through', () => {
    render(
      <DateField
        label="Date"
        required
        help="Set to today."
        value="2026-10-19"
        max="2026-10-19"
        onChange={() => {}}
      />,
    )
    const input = screen.getByLabelText('Date (required)')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveAttribute('max', '2026-10-19')
    expect(input).toHaveValue('2026-10-19')
    expect(input).toHaveAccessibleDescription('Set to today.')
  })
})

describe('PasswordField', () => {
  it('toggles between hidden and shown', async () => {
    render(<PasswordField label="Password" help="At least 8 characters." />)
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAccessibleDescription('At least 8 characters.')

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveTextContent('Hide')

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('does not submit the form when toggled', async () => {
    let submitted = false
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submitted = true
        }}
      >
        <PasswordField label="Password" />
      </form>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(submitted).toBe(false)
  })
})

describe('SearchInput', () => {
  it('is a labelled search box', async () => {
    render(<SearchInput label="Search by name" />)
    const box = screen.getByRole('searchbox', { name: 'Search by name' })
    expect(box).toHaveAttribute('placeholder', 'Search by name')
    await userEvent.type(box, 'Mar')
    expect(box).toHaveValue('Mar')
  })
})

describe('Select', () => {
  it('labels the select inline', async () => {
    render(
      <Select label="Person" defaultValue="all">
        <option value="all">Everyone</option>
        <option value="maria">Maria Santos</option>
      </Select>,
    )
    const select = screen.getByRole('combobox', { name: 'Person' })
    await userEvent.selectOptions(select, 'maria')
    expect(select).toHaveValue('maria')
  })

  it('renders bare without a label', () => {
    render(
      <Select aria-label="Sort" className="x">
        <option>Name</option>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveClass(styles.select, 'x')
  })
})
