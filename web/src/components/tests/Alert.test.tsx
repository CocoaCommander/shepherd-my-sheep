import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from '../Alert/Alert'
import styles from '../Alert/Alert.module.css'
import { Button } from '../Button/Button'

describe('Alert', () => {
  it('is an alert banner with a title, body, icon and one action', () => {
    render(
      <Alert
        title="4 people are overdue for contact"
        action={<Button variant="danger">Review now</Button>}
      >
        Elena Petrova has gone 21 days.
      </Alert>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass(styles.alert)
    expect(alert).not.toHaveClass(styles.inline)
    expect(alert).toHaveTextContent('4 people are overdue for contact')
    expect(alert).toHaveTextContent('Elena Petrova has gone 21 days.')
    expect(alert.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review now' })).toBeInTheDocument()
  })

  it('is an inline alert for form errors, without an action', () => {
    render(
      <Alert variant="inline" action={<button>Ignored</button>}>
        That username or password is not right.
      </Alert>,
    )
    expect(screen.getByRole('alert')).toHaveClass(styles.inline)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('announces success politely as a status', () => {
    render(<Alert variant="success">Account created. You can sign in now.</Alert>)
    const status = screen.getByRole('status')
    expect(status).toHaveClass(styles.success)
    expect(status.querySelector('svg')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('can drop the icon', () => {
    render(<Alert icon={null}>No icon</Alert>)
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeInTheDocument()
  })
})
