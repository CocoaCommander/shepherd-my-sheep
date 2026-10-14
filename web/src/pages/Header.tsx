import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useMeQuery } from '../generated/graphql'

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
        {data && <span className="muted">{data.me.name}</span>}
        <button type="button" className="link" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  )
}
