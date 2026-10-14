import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useMeQuery } from '../generated/graphql'

export function Header() {
  const { signOut } = useAuth()
  const { data } = useMeQuery()

  return (
    <header className="header">
      <Link to="/" className="brand">Shepherd My Sheep</Link>
      <div className="header-user">
        {data && <span className="muted">{data.me.name}</span>}
        <button type="button" className="link" onClick={signOut}>Sign out</button>
      </div>
    </header>
  )
}
