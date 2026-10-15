import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useContactAlertsQuery, useMeQuery } from '../generated/graphql'

/** How many of your people need contacting (business rule 6). Links to the list on My people. */
function ContactAlertsBell() {
  const { data } = useContactAlertsQuery()
  const count = data?.contactAlerts.length ?? 0
  const label =
    count === 0
      ? 'No one needs contacting'
      : `${count} ${count === 1 ? 'person needs' : 'people need'} contacting`

  return (
    <Link to="/" className="bell" aria-label={label} title={label}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {count > 0 && <span className="bell-count">{count}</span>}
    </Link>
  )
}

export function Header() {
  const { signOut } = useAuth()
  const { data } = useMeQuery()

  return (
    <header className="header">
      <Link to="/" className="brand">
        Shepherd My Sheep
      </Link>
      <nav className="nav">
        {/* NavLink sets aria-current="page" on the current one; `end` keeps "/" exact. */}
        <NavLink to="/" end>
          My people
        </NavLink>
        <NavLink to="/prayer">Prayer list</NavLink>
      </nav>
      <div className="header-user">
        <ContactAlertsBell />
        {data && <span className="muted">{data.me.name}</span>}
        <button type="button" className="link" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  )
}
