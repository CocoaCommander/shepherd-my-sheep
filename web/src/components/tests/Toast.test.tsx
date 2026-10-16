import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Toast } from '../Toast/Toast'
import styles from '../Toast/Toast.module.css'

describe('Toast', () => {
  it('announces the message and runs its action', async () => {
    const onAction = vi.fn()
    render(<Toast message="Prayer released." actionLabel="Undo" onAction={onAction} />)
    expect(screen.getByRole('status')).toHaveTextContent('Prayer released.')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('has no button without an action', () => {
    render(<Toast message="Saved." actionLabel="Undo" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('floats only when asked', () => {
    const { rerender } = render(<Toast message="Moved." />)
    expect(screen.getByRole('status')).not.toHaveClass(styles.floating)
    rerender(<Toast message="Moved." floating />)
    expect(screen.getByRole('status')).toHaveClass(styles.floating)
  })
})
