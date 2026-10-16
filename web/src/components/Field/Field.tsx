import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { SearchIcon } from '../icons'
import { cx } from '../utils'
import styles from './Field.module.css'

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>

type FieldProps = InputProps & {
  /** Always visible; never rely on placeholder text as the label. */
  label: ReactNode
  /** 12px helper line under the input. */
  help?: ReactNode
  /** Replaces the help line, turns the border danger and sets aria-invalid. */
  error?: ReactNode
  className?: string
}

/** Wires the label, help/error line and aria attributes shared by every text field. */
function useFieldIds(error: ReactNode, help: ReactNode, id?: string) {
  const autoId = useId()
  const inputId = id ?? autoId
  const message = error || help
  const helpId = message ? `${inputId}-help` : undefined
  return { inputId, helpId, message }
}

function FieldShell({
  label,
  inputId,
  helpId,
  message,
  error,
  className,
  children,
}: {
  label: ReactNode
  inputId: string
  helpId?: string
  message: ReactNode
  error: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx(styles.field, error ? styles.error : undefined, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      {children}
      {message && (
        <span id={helpId} className={styles.help}>
          {message}
        </span>
      )}
    </div>
  )
}

/** A labelled 48px text input with an optional help or error line below. */
export function TextField({
  label,
  help,
  error,
  className,
  id,
  type = 'text',
  ...rest
}: FieldProps) {
  const { inputId, helpId, message } = useFieldIds(error, help, id)
  return (
    <FieldShell {...{ label, inputId, helpId, message, error, className }}>
      <input
        {...rest}
        id={inputId}
        type={type}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={helpId}
      />
    </FieldShell>
  )
}

/** A password input joined with a Show/Hide button. */
export function PasswordField({
  label,
  help,
  error,
  className,
  id,
  ...rest
}: Omit<FieldProps, 'type'>) {
  const { inputId, helpId, message } = useFieldIds(error, help, id)
  const [shown, setShown] = useState(false)
  return (
    <FieldShell {...{ label, inputId, helpId, message, error, className }}>
      <span className={styles.group}>
        <input
          {...rest}
          id={inputId}
          type={shown ? 'text' : 'password'}
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={helpId}
        />
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
