import { ApolloProvider } from '@apollo/client'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createApolloClient } from './apolloClient'

const TOKEN_KEY = 'shepherd.accessToken'

// Storage can be unavailable (private windows, blocked site data); the
// app still works, the user just signs in again after a reload.
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Ignored, see readStoredToken.
  }
}

interface AuthContextValue {
  isSignedIn: boolean
  signIn: (token: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/** Owns the access token and the Apollo client that sends it. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readStoredToken)

  // The client is created once; refs let its links see the latest token
  // and sign-out without rebuilding it.
  const tokenRef = useRef(token)
  const signOutRef = useRef<() => void>(() => {})

  const client = useMemo(
    () =>
      createApolloClient({
        getToken: () => tokenRef.current,
        onUnauthenticated: () => signOutRef.current(),
      }),
    [],
  )

  const signIn = useCallback((newToken: string) => {
    tokenRef.current = newToken
    storeToken(newToken)
    setToken(newToken)
  }, [])

  const signOut = useCallback(() => {
    tokenRef.current = null
    storeToken(null)
    setToken(null)
    // Drop the previous user's data so the next user never sees it.
    void client.clearStore()
  }, [client])

  useEffect(() => {
    signOutRef.current = signOut
  }, [signOut])

  const value = useMemo(
    () => ({ isSignedIn: token !== null, signIn, signOut }),
    [token, signIn, signOut],
  )

  return (
    <AuthContext.Provider value={value}>
      <ApolloProvider client={client}>{children}</ApolloProvider>
    </AuthContext.Provider>
  )
}
