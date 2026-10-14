import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLoginMutation, useRegisterMutation } from '../generated/graphql'

type Mode = 'login' | 'register'

export function LoginPage() {
  const { isSignedIn, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [login, loginState] = useLoginMutation()
  const [register, registerState] = useRegisterMutation()
  const { loading, error } = mode === 'login' ? loginState : registerState

  if (isSignedIn) {
    return <Navigate to={returnTo} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      const token =
        mode === 'login'
          ? (await login({ variables: { input: { username, password } } })).data?.login.token
          : (await register({ variables: { input: { name, username, password } } })).data?.register
              .token
      if (token) {
        signIn(token)
        navigate(returnTo, { replace: true })
      }
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login')
    loginState.reset()
    registerState.reset()
  }

  return (
    <main className="auth">
      <h1>Shepherd My Sheep</h1>
      <form className="card stack" onSubmit={handleSubmit}>
        <h2>{mode === 'login' ? 'Sign in' : 'Create an account'}</h2>

        {mode === 'register' && (
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error.message}
          </p>
        )}

        <button type="submit" disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" className="link" onClick={switchMode}>
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </main>
  )
}
