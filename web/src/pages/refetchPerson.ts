import { PersonDocument } from '../generated/graphql'

/** Every change on the Person page reloads the person, so all sections stay in step. */
export function refetchPerson(personId: string) {
  return {
    refetchQueries: [{ query: PersonDocument, variables: { id: personId } }],
    awaitRefetchQueries: true,
  }
}
