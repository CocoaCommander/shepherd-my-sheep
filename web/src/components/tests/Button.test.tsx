import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../Button/Button'
import styles from '../Button/Button.module.css'
import { PlusIcon } from '../icons'

describe('Button', () => {
  it('is a primary, non-submitting button by default', () => {
    render(<Button>Add person</Button>)
    const button = screen.getByRole('button', { name: 'Add person' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass(styles.button, styles.primary)
    expect(button).not.toHaveClass(styles.lg)
  })

  it.each(['secondary', 'danger', 'text', 'inverse'] as const)(
    'applies the %s variant',
    (variant) => {
      render(<Button variant={variant}>Go</Button>)
      const button = screen.getByRole('button', { name: 'Go' })
      expect(button).toHaveClass(styles[variant])
      expect(button).not.toHaveClass(styles.primary)
    },
  )

  it('can be the full-width submit button of a form', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" size="lg">
          Sign in
        </Button>
      </form>,
    )
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button).toHaveClass(styles.lg)
    button.click()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('renders a leading icon without changing its accessible name', () => {
    render(<Button icon={<PlusIcon />}>Add person</Button>)
    const button = screen.getByRole('button', { name: 'Add person' })
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('calls onClick and respects disabled', async () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Release</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(onClick).toHaveBeenCalledOnce()

    rerender(
      <Button onClick={onClick} disabled>
        Release
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders as a router link with `as`', () => {
    render(
      <MemoryRouter>
        <Button as={Link} to="/people/1" variant="secondary">
          Open
        </Button>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Open' })
    expect(link).toHaveAttribute('href', '/people/1')
    expect(link).not.toHaveAttribute('type')
    expect(link).toHaveClass(styles.button, styles.secondary)
  })

  it('passes through a custom className', () => {
    render(<Button className="extra">Go</Button>)
    expect(screen.getByRole('button')).toHaveClass('extra', styles.button)
  })
})
