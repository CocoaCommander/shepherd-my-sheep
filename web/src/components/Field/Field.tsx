import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { SearchIcon, WarningIcon } from '../icons'
import { cx } from '../utils'
import styles from './Field.module.css'

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>

/** Props every labelled field shares, whatever its control. */
type ShellProps = {
  /** Always visible; never rely on placeholder text as the label. */
  label: ReactNode
  /** 12px helper line under the input. */
  help?: ReactNode
  /** Replaces the help line, turns the border danger, sets aria-invalid and is announced. */
  error?: ReactNode
  /**
   * Adds " (required)" or " (optional)" to the label in words and sets aria-required.
   * Leave it out to say neither. It doesn't set the native `required`, so the browser's own
   * validation popup never pre-empts the form's messages.
   */
  required?: boolean
  className?: string
}

type FieldProps = Omit<InputProps, 'required'> & ShellProps

/** Wires the label, help/error line and aria attributes shared by every text field. */
function useField({ error, help, required }: ShellProps, id?: string) {
  const autoId = useId()
  const inputId = id ?? autoId
  const helpId = error || help ? `${inputId}-help` : undefined
  return {
    inputId,
    helpId,
    aria: {
      id: inputId,
      'aria-invalid': error ? true : undefined,
      'aria-required': required || undefined,
      'aria-describedby': helpId,
    },
  }
}

function FieldShell({
  label,
  help,
  error,
  required,
  className,
  inputId,
  helpId,
  children,
}: ShellProps & { inputId: string; helpId?: string; children: ReactNode }) {
  return (
    <div className={cx(styles.field, error ? styles.error : undefined, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
        {required !== undefined && (
          <>
            {' '}
            <span className={styles.requirement}>{required ? '(required)' : '(optional)'}</span>
          </>
        )}
      </label>
      {children}
      {/* Keyed so the alert mounts fresh and is announced, rather than the help line changing role. */}
      {error ? (
        <span key="error" id={helpId} role="alert" className={styles.help}>
          <WarningIcon className={styles.helpIcon} />
          {error}
        </span>
      ) : (
        help && (
          <span key="help" id={helpId} className={styles.help}>
            {help}
          </span>
        )
      )}
    </div>
  )
}

/** A labelled 48px text input with an optional help or error line below. */
export function TextField({
  label,
  help,
  error,
  required,
  className,
  id,
  type = 'text',
  ...rest
}: FieldProps) {
  const shell = { label, help, error, required, className }
  const { inputId, helpId, aria } = useField(shell, id)
  return (
    <FieldShell {...shell} inputId={inputId} helpId={helpId}>
      <input {...rest} {...aria} type={type} className={styles.input} />
    </FieldShell>
  )
}

/** A labelled date picker. `value`, `min` and `max` are YYYY-MM-DD. */
export function DateField(props: Omit<FieldProps, 'type'>) {
  return <TextField {...props} type="date" />
}

/** A labelled multi-line text box; the user can drag it taller. */
export function TextArea({
  label,
  help,
  error,
  required,
  className,
  id,
  rows = 4,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'required'> & ShellProps) {
  const shell = { label, help, error, required, className }
  const { inputId, helpId, aria } = useField(shell, id)
  return (
    <FieldShell {...shell} inputId={inputId} helpId={helpId}>
      <textarea {...rest} {...aria} rows={rows} className={cx(styles.input, styles.textarea)} />
    </FieldShell>
  )
}

/** A password input joined with a Show/Hide button. */
export function PasswordField({
  label,
  help,
  error,
  required,
  className,
  id,
  ...rest
}: Omit<FieldProps, 'type'>) {
  const shell = { label, help, error, required, className }
  const { inputId, helpId, aria } = useField(shell, id)
  const [shown, setShown] = useState(false)
  return (
    <FieldShell {...shell} inputId={inputId} helpId={helpId}>
      <span className={styles.group}>
        <input {...rest} {...aria} type={shown ? 'text' : 'password'} className={styles.input} />
        <button
          type="button"
          className={styles.toggle}
          aria-controls={inputId}
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </span>
    </FieldShell>
  )
}

/** A 44px search box with a leading magnifier. `label` is its accessible name and placeholder. */
export function SearchInput({
  label,
  className,
  placeholder,
  ...rest
}: Omit<InputProps, 'type'> & { label: string; className?: string }) {
  return (
    <label className={cx(styles.search, className)}>
      <SearchIcon />
      <input
        {...rest}
        type="search"
        className={styles.searchInput}
        aria-label={label}
        placeholder={placeholder ?? label}
      />
    </label>
  )
}

/** A 44px select, with an optional muted label inline before it. */
export function Select({
  label,
  className,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  label?: ReactNode
  className?: string
}) {
  const select = (
    <select {...rest} className={cx(styles.select, !label && className)}>
      {children}
    </select>
  )
  if (!label) return select
  return (
    <label className={cx(styles.selectLabel, className)}>
      {label}
      {select}
    </label>
  )
}
