import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Button,
  CheckIcon,
  StatusPill,
  StepsPanel,
  TextArea,
  TextField,
} from '../components'
import { friendlyMessage } from '../errors'
import { firstName, formatShortDate } from '../format'
import {
  MyPeopleDocument,
  useCreatePersonMutation,
  useStatusesQuery,
  type CreatePersonMutation,
} from '../generated/graphql'
import styles from './AddPersonPage.module.css'
import { Header } from './Header'

type AddedPerson = CreatePersonMutation['createPerson']

type Errors = { name?: string; age?: string; yearMet?: string }

/** Matches the person table's CHECKs and create_person's year check (V006). */
const MAX_AGE = 120
const MIN_YEAR_MET = 1900

/** Adds a person as a new contact, then shows when their first contact is due. */
export function AddPersonPage() {
  const [added, setAdded] = useState<AddedPerson | null>(null)

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link to="/people">My people</Link> <span aria-hidden="true">/</span> Add person
        </nav>
        <div className={styles.layout}>
          <section className={styles.card}>
            {/* The form remounts on "Add another person", so it starts empty. */}
            {added ? (
              <Confirmation person={added} onAddAnother={() => setAdded(null)} />
            ) : (
              <AddPersonForm onAdded={setAdded} />
            )}
          </section>
          <aside className={styles.aside}>
            <StepsPanel items={nextSteps(added?.contactDueAt)} />
            {/* Business rules 2, 3 and 4. */}
            <p className={styles.note}>
              A person may start with no comment, no prayer burdens and no milestones. Those are
              added over time.
            </p>
          </aside>
        </div>
      </main>
    </div>
  )
}

/** The deadline is the server's (person_contact_state), so it's shown only once they're added. */
function nextSteps(dueAt: string | null | undefined) {
  const step = (title: string, detail: string) => (
    <span>
      <span className={styles.stepTitle}>{title}</span>
      <span className={styles.stepDetail}>{detail}</span>
    </span>
  )
  return [
    step('Added as a New contact', 'Today. A comment is optional, you can add one now or later.'),
    step(
      'Log a contact within 72 hours',
      `${dueAt ? `By ${formatShortDate(dueAt)}. ` : ''}Use Log contact on their page: a date and a comment are required, a prayer burden is optional.`,
    ),
    step(
      'Then every 7 days',
      'After that first contact they become Active. Each new contact is due within 7 days of the last one.',
    ),
  ]
}

function AddPersonForm({ onAdded }: { onAdded: (person: AddedPerson) => void }) {
  const formId = useId()
  // The year the form opened in; the server allows up to the current year anywhere on Earth.
  const [currentYear] = useState(() => new Date().getFullYear())
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [yearMet, setYearMet] = useState(String(currentYear))
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState<Errors>({})

  const { data: statusData, error: statusError } = useStatusesQuery()
  const newContactId = statusData?.statuses.find((s) => s.name === 'new contact')?.id
  const [createPerson, { loading, error }] = useCreatePersonMutation({
    refetchQueries: [{ query: MyPeopleDocument }],
  })
  // Without the statuses there's no 'new contact' id to send, so say why the button is off.
  const shownError = error ?? statusError

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (loading || !newContactId) return
    const found: Errors = {
      name: name.trim() ? undefined : 'Enter a name.',
      age: inRange(age, 0, MAX_AGE) ? undefined : `Enter an age between 0 and ${MAX_AGE}.`,
      yearMet: inRange(yearMet, MIN_YEAR_MET, currentYear)
        ? undefined
        : `Enter a year from ${MIN_YEAR_MET} to ${currentYear}.`,
    }
    setErrors(found)
    const firstInvalid = (['name', 'age', 'yearMet'] as const).find((field) => found[field])
    if (firstInvalid) {
      document.getElementById(`${formId}-${firstInvalid}`)?.focus()
      return
    }

    const note = comment.trim()
    try {
      const result = await createPerson({
        variables: {
          input: {
            name: name.trim(),
            statusId: newContactId,
            age: age.trim() ? Number(age) : null,
            yearMet: yearMet.trim() ? Number(yearMet) : null,
            ...(note && { comment: note }),
          },
        },
      })
      if (result.data) onAdded(result.data.createPerson)
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form noValidate onSubmit={submit} className={styles.form}>
      <div>
        <h1 className={styles.title}>Add a person</h1>
        <p className={styles.lead}>Add someone you have just met or are starting to care for.</p>
      </div>
      {shownError && <Alert variant="inline">{friendlyMessage(shownError)}</Alert>}
      <TextField
        id={`${formId}-name`}
        label="Name"
        required
        autoComplete="off"
        placeholder="Full name"
        maxLength={100}
        value={name}
        error={errors.name}
        onChange={(e) => {
          setName(e.target.value)
          setErrors((prev) => ({ ...prev, name: undefined }))
        }}
      />
      <div className={styles.pair}>
        <TextField
          id={`${formId}-age`}
          label="Age"
          required={false}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_AGE}
          value={age}
          error={errors.age}
          onChange={(e) => {
            setAge(e.target.value)
            setErrors((prev) => ({ ...prev, age: undefined }))
          }}
        />
        <TextField
          id={`${formId}-yearMet`}
          label="Year met"
          required={false}
          type="number"
          inputMode="numeric"
          min={MIN_YEAR_MET}
          max={currentYear}
          value={yearMet}
          error={errors.yearMet}
          onChange={(e) => {
            setYearMet(e.target.value)
            setErrors((prev) => ({ ...prev, yearMet: undefined }))
          }}
        />
      </div>
      <TextArea
        label="Comment"
        required={false}
        rows={4}
        placeholder="How did you meet? Anything worth remembering?"
        value={comment}
        help="Saved as a note on their page. You can leave it empty."
        onChange={(e) => setComment(e.target.value)}
      />
      <dl className={styles.facts}>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusPill status="new" />
          </dd>
        </div>
        <div>
          <dt>Shepherd</dt>
          <dd className={styles.strong}>You</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        <Button type="submit" disabled={loading || !newContactId}>
          {loading ? 'Adding…' : 'Add person'}
        </Button>
        <Button as={Link} to="/people" variant="text" className={styles.cancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Blank, or a whole number from min to max. */
function inRange(value: string, min: number, max: number): boolean {
  if (!value.trim()) return true
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max
}

function Confirmation({ person, onAddAnother }: { person: AddedPerson; onAddAnother: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const first = firstName(person.name)

  // The form this replaced had focus; move it here so screen readers hear the result.
  useEffect(() => heading.current?.focus(), [])

  return (
    <div className={styles.confirmation}>
      <div className={styles.done}>
        <span className={styles.doneIcon}>
          <CheckIcon size={30} />
        </span>
        <h1 ref={heading} tabIndex={-1} className={styles.doneTitle}>
          {person.name} added
        </h1>
        <p className={styles.lead}>
          Log a contact with {first} within 72 hours
          {person.contactDueAt && `, by ${formatShortDate(person.contactDueAt)}`}. If that passes,
          an alert shows on Home.
        </p>
      </div>
      <div className={styles.actions}>
        {/* The Person page opens the Log contact dialog for this state, then clears it. */}
        <Button as={Link} to={`/people/${person.id}`} state={{ logContact: true }}>
          Log contact now
        </Button>
        <Button variant="secondary" onClick={onAddAnother}>
          Add another person
        </Button>
        <Button as={Link} to="/people" variant="secondary">
          Back to My people
        </Button>
      </div>
    </div>
  )
}
