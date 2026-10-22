import { useId, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import {
  Alert,
  Brand,
  Button,
  CheckIcon,
  ClockIcon,
  HeartIcon,
  PasswordField,
  TextField,
} from '../components'
import { friendlyMessage } from '../errors'
import { useLoginMutation, useRegisterMutation } from '../generated/graphql'
import styles from './LoginPage.module.css'

type Mode = 'login' | 'register'

type Errors = { name?: string; username?: string; password?: string }

const MIN_PASSWORD = 8

function validate(mode: Mode, name: string, username: string, password: string): Errors {
  const errors: Errors = {}
  if (mode === 'register' && !name.trim()) errors.name = 'Enter your name.'
  if (!username.trim()) errors.username = 'Enter your username.'
  if (!password) errors.password = 'Enter your password.'
  else if (mode === 'register' && password.length < MIN_PASSWORD) {
    errors.password = 'Use at least 8 characters.'
  }
  return errors
}

const POINTS = [
  {
    icon: <ClockIcon size={18} />,
    title: 'Know who needs contact.',
    body: 'Weekly reminders for active members, and a 72-hour follow-up for new contacts.',
  },
  {
    icon: <CheckIcon size={18} />,
    title: 'See their journey.',
    body: 'Baptism, small group, serving and leading, in one place.',
  },
  {
    icon: <HeartIcon size={18} />,
    title: 'Pray with purpose.',
    body: 'A prayer list shared with the other shepherds.',
  },
]

/**
 * Sign in and register on one screen. On web a brand panel sits beside the form; below
 * 720px it shrinks to a short header above it. Field errors show after the first submit
 * and then follow the input; server errors show in a banner above the form.
 */
export function LoginPage() {
  const { isSignedIn, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tried, setTried] = useState(false)
  const ids = { name: useId(), username: useId(), password: useId() }

  const [login, loginState] = useLoginMutation()
  const [register, registerState] = useRegisterMutation()
  const { loading, error } = mode === 'login' ? loginState : registerState

  if (isSignedIn) {
    return <Navigate to={returnTo} replace />
  }

  const registering = mode === 'register'
  const errors = tried ? validate(mode, name, username, password) : {}

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    loginState.reset()
    registerState.reset()
    setTried(true)
    const found = validate(mode, name, username, password)
    const firstInvalid = (['name', 'username', 'password'] as const).find((key) => found[key])
    if (firstInvalid) {
      document.getElementById(ids[firstInvalid])?.focus()
      return
    }
    try {
      const token = registering
        ? (await register({ variables: { input: { name: name.trim(), username, password } } })).data
            ?.register.token
        : (await login({ variables: { input: { username, password } } })).data?.login.token
      if (token) {
        signIn(token)
        navigate(returnTo, { replace: true })
      }
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  function switchMode() {
    setMode(registering ? 'login' : 'register')
    setTried(false)
    loginState.reset()
    registerState.reset()
  }

  return (
    <div className={styles.page}>
      <aside className={styles.panel}>
        <Brand className={styles.brand} />
        <div className={styles.pitch}>
          <p className={styles.tagline}>Keep track of the people you are caring for.</p>
          <ul className={styles.points}>
            {POINTS.map((point) => (
              <li key={point.title} className={styles.point}>
                <span className={styles.pointIcon}>{point.icon}</span>
                <span>
                  <strong className={styles.pointTitle}>{point.title}</strong> {point.body}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.footnote}>
          Only people you add as shepherds can see the people you care for.
        </p>
      </aside>

      <main className={styles.main}>
        <form className={styles.form} noValidate onSubmit={handleSubmit}>
          <div className={styles.intro}>
            <h1 className={styles.title}>{registering ? 'Create your account' : 'Welcome back'}</h1>
            <p className={styles.sub}>
              {registering ? (
                <>
                  It takes a minute.
                  <span className={styles.wideOnly}> Then add the people you are caring for.</span>
                </>
              ) : (
                'Sign in to see who needs contact today.'
              )}
            </p>
          </div>

          {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}

          {registering && (
            <TextField
              id={ids.name}
              label="Name"
              help="What other shepherds will see."
              error={errors.name}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <TextField
            id={ids.username}
            label="Username"
            help={registering ? 'Other shepherds use this to find you.' : undefined}
            error={errors.username}
            value={username}
            maxLength={50}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
          <PasswordField
            id={ids.password}
            label="Password"
            help={registering ? 'At least 8 characters.' : undefined}
            error={errors.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={registering ? 'new-password' : 'current-password'}
          />

          <Button type="submit" size="lg" disabled={loading}>
            {loading ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
          </Button>
          <Button variant="text" className={styles.switch} onClick={switchMode}>
            {registering ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Button>
        </form>
      </main>
    </div>
  )
}
