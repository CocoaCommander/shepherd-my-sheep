import type { ApolloError } from '@apollo/client'
import { friendlyMessage } from '../errors'

export function ErrorMessage({ error }: { error: ApolloError | undefined }) {
  if (!error) return null
  return (
    <p className="error small" role="alert">
      {friendlyMessage(error)}
    </p>
  )
}
