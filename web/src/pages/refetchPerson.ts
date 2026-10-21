import type { ApolloCache } from '@apollo/client'
import { PersonDocument } from '../generated/graphql'

/** Every change on the Person page reloads the person, so all sections stay in step. */
export function refetchPerson(personId: string) {
  return {
    refetchQueries: [{ query: PersonDocument, variables: { id: personId } }],
    awaitRefetchQueries: true,
  }
}

// Lists that show a person's burdens or latest comment (Prayer list, Home, My people).
const PRAYER_LIST_FIELDS = ['activePrayerBurdens', 'recentlyReleasedPrayerBurdens', 'myPeople']

/**
 * For a burden or comment change: reloads the person, and drops any cached prayer lists and
 * My people so they load fresh when next shown, without fetching them now.
 */
export function refetchPersonAndPrayerLists(personId: string) {
  return {
    ...refetchPerson(personId),
    update(cache: ApolloCache<unknown>) {
      for (const fieldName of PRAYER_LIST_FIELDS) cache.evict({ id: 'ROOT_QUERY', fieldName })
    },
  }
}
