import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import shared from '../shared.module.css'
import { Toast } from '../Toast/Toast'
import styles from '../Toast/Toast.module.css'
import { TOAST_MS, useUndoToast } from '../Toast/useUndoToast'

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

describe('useUndoToast', () => {
  let api: ReturnType<typeof useUndoToast>
  function Host() {
    api = useUndoToast({ floating: true })
    return api.toastElement
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps an empty, hidden live region mounted until shown', () => {
    render(<Host />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')
    expect(region).toHaveClass(shared.srOnly)
    expect(region).not.toHaveClass(styles.floating)

    act(() => api.show('Contact logged with Maria.'))
    // The same node, so screen readers announce the new text.
    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent('Contact logged with Maria.')
    expect(region).not.toHaveClass(shared.srOnly)
    expect(region).toHaveClass(styles.floating)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('stays up 20 seconds, with or without Undo', () => {
    render(<Host />)
    act(() => api.show('Saved.'))
    act(() => vi.advanceTimersByTime(TOAST_MS - 1))
    expect(screen.getByRole('status')).toHaveTextContent('Saved.')
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('status')).toHaveTextContent('')

    act(() => api.show('Contact logged.', () => {}))
    act(() => vi.advanceTimersByTime(TOAST_MS - 1))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('restarts the clock when a new message replaces the old', () => {
    render(<Host />)
    act(() => api.show('First.'))
    act(() => vi.advanceTimersByTime(TOAST_MS - 5))
    act(() => api.show('Second.'))
    act(() => vi.advanceTimersByTime(10))
    expect(screen.getByRole('status')).toHaveTextContent('Second.')
  })

  it('hides itself, then runs the undo', () => {
    render(<Host />)
    const onUndo = vi.fn()
    act(() => api.show('Contact logged.', onUndo))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('can be hidden early', () => {
    render(<Host />)
    act(() => api.show('Saved.'))
    act(() => api.hide())
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})
