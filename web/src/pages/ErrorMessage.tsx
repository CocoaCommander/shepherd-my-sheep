import type { ApolloError } from '@apollo/client'

export function ErrorMessage({ error }: { error: ApolloError | undefined }) {
  if (!error) return null
  return (
    <p className="error small" role="alert">
      {error.message}
    </p>
  )
}
