import type { ElementType, ReactNode } from 'react'
import { cx, type PolymorphicProps } from '../utils'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text' | 'inverse'

type ButtonOwnProps = {
  /** primary: the one main action in a view. danger: the action on an overdue card. inverse: inside a Toast. */
  variant?: ButtonVariant
  /** lg is the full-width, 50px submit button of a form. */
  size?: 'md' | 'lg'
  /** A 16px leading icon. */
  icon?: ReactNode
  className?: string
  children?: ReactNode
}

export type ButtonProps<E extends ElementType = 'button'> = PolymorphicProps<E, ButtonOwnProps>

export function Button<E extends ElementType = 'button'>({
  as,
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonProps<E>) {
  const Component: ElementType = as ?? 'button'
  // A bare <button> defaults to type="submit"; make that opt-in.
  const typeDefault = Component === 'button' ? { type: 'button' } : {}
  return (
    <Component
      {...typeDefault}
      {...rest}
      className={cx(styles.button, styles[variant], size === 'lg' && styles.lg, className)}
    >
      {icon}
      {children}
    </Component>
  )
}
