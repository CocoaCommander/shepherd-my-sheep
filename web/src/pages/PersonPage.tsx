import { useEffect, useId, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert } from '../components'
import { errorCode, friendlyMessage } from '../errors'
import { useMeQuery, usePersonQuery, type PersonQuery } from '../generated/graphql'
import { NARROW, useMediaQuery } from '../useMediaQuery'
import { useLogContactToast } from './contactToast'
import { Header } from './Header'
import { LogContactDialog } from './LogContactDialog'
import { PersonHeaderCard } from './PersonHeaderCard'
import { PersonMilestones } from './PersonMilestones'
import { PersonNotes } from './PersonNotes'
import styles from './PersonPage.module.css'
import { PersonPrayerBurdens } from './PersonPrayerBurdens'
import { PersonSidebar } from './PersonSidebar'
import { PersonStatusSelect } from './PersonStatusSelect'
import { useStatusMove } from './useStatusMove'

export function PersonPage() {
  const { id = '' } = useParams()
  const { data, loading, error } = usePersonQuery({ variables: { id } })
  const { data: meData } = useMeQuery()
  // A malformed id in the URL is rejected as bad input; to the user it's
  // the same as someone who doesn't exist.
  const notFound =
    (data && !data.person) || ['BAD_USER_INPUT', 'NOT_FOUND'].includes(errorCode(error) ?? '')

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link to="/people">My people</Link>
          {data?.person && (
            <>
              {' '}
              <span aria-hidden="true">/</span> {data.person.name}
            </>
          )}
        </nav>

        {loading && <p className={styles.muted}>Loading…</p>}
        {error && !notFound && <Alert variant="inline">{friendlyMessage(error)}</Alert>}

        {/* null for someone who doesn't exist or isn't assigned to you */}
        {notFound && <p className={styles.muted}>This person was not found.</p>}

        {data?.person && <PersonDetail person={data.person} meId={meData?.me.id} />}
      </main>
    </div>
  )
}

type Person = NonNullable<PersonQuery['person']>

/** Set by Add person's "Log contact now", to open the dialog on arrival. */
type PersonLocationState = { logContact?: boolean } | null

function PersonDetail({ person, meId }: { person: Person; meId: string | undefined }) {
  const location = useLocation()
  const navigate = useNavigate()
  const askedToLog = Boolean((location.state as PersonLocationState)?.logContact)
  const [logging, setLogging] = useState(askedToLog)
  const narrow = useMediaQuery(NARROW)
  const { show, showLogged, toastElement } = useLogContactToast({ floating: true })
  // New contact → Active opens Log contact; saving it does the move, Cancel leaves the status.
  const { move, canMove } = useStatusMove<Person>({
    show,
    narrow,
    onLogContact: () => setLogging(true),
  })
  // In the header card on the web, in Details on phones; only one is in the DOM.
  const statusSelect = (label?: string) => (
    <PersonStatusSelect
      person={person}
      disabled={!canMove}
      onMove={(to) => move(person, to)}
      label={label}
    />
  )
  const notesFieldId = useId()

  // Clear the request, so Back or a reload doesn't open the dialog again.
  useEffect(() => {
    if (askedToLog) navigate(location.pathname, { replace: true, state: null })
  }, [askedToLog, location.pathname, navigate])

  return (
    <>
      <PersonHeaderCard
        person={person}
        meId={meId}
        notesFieldId={notesFieldId}
        statusSelect={narrow ? undefined : statusSelect()}
        onLogContact={() => setLogging(true)}
      />
      {/* LogContact returns the person's activity, so the cache updates this page. */}
      <LogContactDialog
        person={person}
        open={logging}
        onClose={() => setLogging(false)}
        onSaved={(saved, wasNewContact) => {
          setLogging(false)
          showLogged(saved, wasNewContact)
        }}
      />
      {toastElement}

      <div className={styles.columns}>
        <div className={styles.main}>
          <PersonMilestones person={person} narrow={narrow} />
          <PersonPrayerBurdens person={person} meId={meId} narrow={narrow} show={show} />
          <PersonNotes person={person} meId={meId} fieldId={notesFieldId} />
        </div>
        <PersonSidebar
          person={person}
          meId={meId}
          statusSelect={narrow ? statusSelect('Status') : undefined}
        />
      </div>
    </>
  )
}
