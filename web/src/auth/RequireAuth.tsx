import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth()
  const location = useLocation()

  if (!isSignedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}
