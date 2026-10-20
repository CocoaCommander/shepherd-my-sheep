import type { PersonStatus } from '../components'

/** The API's status names → the design system's StatusPill statuses. */
export const STATUS_BY_NAME: Record<string, PersonStatus> = {
  'new contact': 'new',
  active: 'active',
  inactive: 'inactive',
  'lost contact': 'lost',
}
