import type { ComponentPropsWithoutRef, ElementType } from 'react'

/** Joins class names, skipping falsy ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

/**
 * Props for a component that renders as `E` (a tag name or a component such as react-router's
 * Link), so the library stays router-agnostic: `<Button as={Link} to="/people">`.
 */
export type PolymorphicProps<E extends ElementType, P> = P & { as?: E } & Omit<
    ComponentPropsWithoutRef<E>,
    keyof P | 'as'
  >

/** A person's pastoral status, in the order the board shows them. */
export type PersonStatus = 'new' | 'active' | 'inactive' | 'lost'

export const STATUS_LABELS: Record<PersonStatus, string> = {
  new: 'New contact',
  active: 'Active',
  inactive: 'Inactive',
  lost: 'Lost contact',
}
