import { useState } from 'react'
import type { ApolloError } from '@apollo/client'
import { ErrorMessage } from './ErrorMessage'

/** A destructive action that asks inline before it runs; nothing happens on Cancel. */
export function ActionButton({
  label,
  ariaLabel,
  question,
  confirmLabel,
  danger = false,
  loading,
  error,
  onClick,
}: {
  label: string
  ariaLabel?: string
  question: string
  confirmLabel: string
  /** Shows the button itself in red, for actions that can't be undone. */
  danger?: boolean
  loading: boolean
  error: ApolloError | undefined
  onClick: () => Promise<unknown>
}) {
  const [confirming, setConfirming] = useState(false)

  async function handleConfirm() {
    try {
      await onClick()
    } catch {
      // Shown from the mutation's `error` below.
    }
    setConfirming(false)
  }

  return (
    <span className="action">
      {confirming ? (
        <span className="confirm">
          <span className="small">{question}</span>
          <button type="button" className="link danger" disabled={loading} onClick={handleConfirm}>
            {loading ? 'Working…' : confirmLabel}
          </button>
          <button
            type="button"
            className="link"
            disabled={loading}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`link${danger ? ' danger' : ''}`}
          aria-label={ariaLabel}
          onClick={() => setConfirming(true)}
        >
          {label}
        </button>
      )}
      <ErrorMessage error={error} />
    </span>
  )
}
