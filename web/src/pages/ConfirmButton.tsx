import { useState, type ReactNode } from 'react'
import type { ApolloError } from '@apollo/client'
import { Alert, Button, Dialog } from '../components'
import { cx } from '../components/utils'
import { friendlyMessage } from '../errors'
import styles from './ConfirmButton.module.css'

/**
 * An action that can't be undone: the button opens a dialog that asks first, and nothing
 * happens on Cancel. The dialog stays open with the error if the action fails.
 */
export function ConfirmButton({
  label,
  ariaLabel,
  title,
  body,
  confirmLabel,
  danger = false,
  className,
  loading,
  error,
  onConfirm,
}: {
  label: ReactNode
  ariaLabel?: string
  /** The question, e.g. "Remove Grace Lin as a shepherd?". The dialog's title. */
  title: string
  /** What happens, in a sentence. */
  body: ReactNode
  confirmLabel: string
  /** Shows the button itself in the danger colour, for deleting a person. */
  danger?: boolean
  className?: string
  loading: boolean
  error: ApolloError | undefined
  /** Rejects when the action failed, which keeps the dialog open. */
  onConfirm: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const close = () => {
    if (!loading) setOpen(false)
  }

  async function confirm() {
    try {
      await onConfirm()
      setOpen(false)
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <>
      <Button
        variant="text"
        className={cx(styles.trigger, danger && styles.danger, className)}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={title}
        footer={
          <>
            <Button variant="secondary" disabled={loading} onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" disabled={loading} onClick={confirm}>
              {loading ? 'Working…' : confirmLabel}
            </Button>
          </>
        }
      >
        <p className={styles.body}>{body}</p>
        {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      </Dialog>
    </>
  )
}
