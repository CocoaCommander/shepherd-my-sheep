import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { PasswordField, SearchInput, Select, TextField } from '../Field/Field'
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
