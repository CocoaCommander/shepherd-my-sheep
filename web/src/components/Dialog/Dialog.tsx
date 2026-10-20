import { useEffect, useId, useRef, type ReactNode } from 'react'
import { CloseIcon } from '../icons'
import { cx } from '../utils'
import styles from './Dialog.module.css'

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * A modal dialog on the native <dialog>, whose showModal() traps focus and makes the page
 * behind it inert. The caller owns `open`; Escape and the close button ask via onClose.
 *
 * - The title is its accessible name.
 * - Its content mounts only while open, so a form inside starts fresh on every open.
 * - On open, focus goes to the first control in the body (else the close button). On close,
 *   it goes back to whatever had focus when it opened.
 * - Put the footer's primary button last: below 719px the buttons stack with it on top.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  /** e.g. "Log contact with Maria". Rendered as the h2. */
  title: ReactNode
  children: ReactNode
  /** The action buttons, e.g. Cancel then a primary Save. */
  footer?: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    const first = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? closeRef.current)?.focus()
    return () => {
      if (dialog.open) dialog.close()
      returnTo?.focus()
    }
  }, [open])

  // Escape fires `cancel`; keep the dialog open until the caller says so through `open`.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [onClose])

  return (
    <dialog ref={ref} aria-labelledby={titleId} className={cx(styles.dialog, className)}>
      {open && (
        <>
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <button
              ref={closeRef}
              type="button"
              className={styles.close}
              aria-label="Close"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
          <div ref={bodyRef} className={styles.body}>
            {children}
          </div>
          {footer && <div className={styles.footer}>{footer}</div>}
        </>
      )}
    </dialog>
  )
}
