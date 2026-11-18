import type { MilestoneFieldsFragment } from '../generated/graphql'

/** The API's limits (createMilestone / updateMilestone), in characters after trimming. */
export const MAX_NAME = 100
export const MAX_DESCRIPTION = 1000

/** Characters as the server counts them (code points), not UTF-16 units. */
const length = (text: string) => [...text].length

/**
 * The name's problem, worded as the server words it, or undefined. Names are unique ignoring
 * case (business rule 7); `exceptId` is the milestone being renamed, which may change only
 * its own case.
 */
export function nameError(
  name: string,
  list: readonly Pick<MilestoneFieldsFragment, 'id' | 'name'>[],
  exceptId?: string,
): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a name for the milestone.'
  if (length(trimmed) > MAX_NAME) return `Use ${MAX_NAME} characters or fewer.`
  const lower = trimmed.toLowerCase()
  const taken = list.find((m) => m.id !== exceptId && m.name.toLowerCase() === lower)
  return taken ? `A milestone called “${taken.name}” already exists.` : undefined
}

export function descriptionError(description: string): string | undefined {
  return length(description.trim()) > MAX_DESCRIPTION
    ? `Use ${MAX_DESCRIPTION} characters or fewer for the description.`
    : undefined
}

/** "Recorded for 1 person", "Recorded for 6 people", or "Not recorded yet". */
export function recordedText(count: number): string {
  return count === 0 ? 'Not recorded yet' : `Recorded for ${people(count)}`
}

export const people = (n: number) => (n === 1 ? '1 person' : `${n} people`)
