import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppHeader, Bell, Brand, Button } from '../components'
import { useContactAlertsQuery, useMeQuery } from '../generated/graphql'

/** How many of your people need contacting (business rule 6). Links to Home, which lists them. */
function ContactAlertsBell() {
  const { data } = useContactAlertsQuery()
  const count = data?.contactAlerts.length ?? 0
  const label =
    count === 0
      ? 'No one needs contacting'
      : `${count} ${count === 1 ? 'person needs' : 'people need'} contacting`

  return <Bell as={Link} to="/" count={count} label={label} />
}

export function Header() {
  const { signOut } = useAuth()
  const { data } = useMeQuery()

  return (
    <AppHeader
      brand={<Brand as={Link} to="/" />}
      nav={
        <>
          {/* NavLink sets aria-current="page" on the current one; `end` keeps "/" exact. */}
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/people">My people</NavLink>
          <NavLink to="/prayer">Prayer list</NavLink>
        </>
      }
      alerts={<ContactAlertsBell />}
      actions={
        <>
          {data && <span>{data.me.name}</span>}
          <Button variant="text" onClick={signOut}>
            Sign out
          </Button>
        </>
      }
    />
  )
}
