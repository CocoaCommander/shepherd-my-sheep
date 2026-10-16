import type { ElementType, ReactNode } from 'react'
import { BellIcon, SheepMark } from '../icons'
import { cx, type PolymorphicProps } from '../utils'
import styles from './AppHeader.module.css'

type BrandOwnProps = { className?: string; children?: ReactNode }

/** The sheep mark and product name. Renders a <span> unless given `as` (e.g. a router Link). */
export function Brand<E extends ElementType = 'span'>({
  as,
  className,
  children = 'Shepherd My Sheep',
  ...rest
}: PolymorphicProps<E, BrandOwnProps>) {
  const Component: ElementType = as ?? 'span'
  return (
    <Component {...rest} className={cx(styles.brand, className)}>
      <SheepMark />
      {children}
    </Component>
  )
}

/**
 * The white top bar on every screen: brand on the left, then navigation and account actions.
 * Put it outside <main>. In focused flows such as Review, leave out `nav` and pass one
 * secondary Button (Exit review) as `actions`.
 */
export function AppHeader({
  brand = <Brand />,
  nav,
  navLabel = 'Main',
  actions,
  className,
}: {
  brand?: ReactNode
  /** Links; mark the current one with aria-current="page" (NavLink does this). */
  nav?: ReactNode
  navLabel?: string
  /** Bell, signed-in name, Sign out. */
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cx(styles.header, className)}>
      {brand}
      {(nav || actions) && (
        <div className={styles.right}>
          {nav && (
            <nav aria-label={navLabel} className={styles.nav}>
              {nav}
            </nav>
          )}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
    </header>
  )
}

type BellOwnProps = {
  /** People needing contact. The badge shows only when it's above zero. */
  count: number
  /** The accessible name, e.g. "4 people need contacting". */
  label: string
  className?: string
}

/** The alerts bell. A <button> by default; pass `as={Link}` to make it a link. */
export function Bell<E extends ElementType = 'button'>({
  as,
  count,
  label,
  className,
  ...rest
}: PolymorphicProps<E, BellOwnProps>) {
  const Component: ElementType = as ?? 'button'
  const typeDefault = Component === 'button' ? { type: 'button' } : {}
  return (
    <Component
      {...typeDefault}
      {...rest}
      aria-label={label}
      title={label}
      className={cx(styles.bell, className)}
    >
      <BellIcon />
      {count > 0 && (
        <span className={styles.bellCount} aria-hidden="true">
          {count}
        </span>
      )}
    </Component>
  )
}
