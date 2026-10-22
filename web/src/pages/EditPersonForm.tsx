import { useState, type FormEvent } from 'react'
import { Alert, Button } from '../components'
import { friendlyMessage } from '../errors'
import {
  useUpdatePersonMutation,
  type PersonQuery,
  type UpdatePersonInput,
} from '../generated/graphql'
import { RELOAD_CONTACT_LISTS } from './contactToast'
import styles from './EditPersonForm.module.css'

type Person = NonNullable<PersonQuery['person']>

const toText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '' : String(value)
const toNumber = (value: string) => (value === '' ? null : Number(value))

/**
 * Name, age and year met. Status has its own dropdown (useStatusMove), and the API's
 * `isActive` flag isn't shown on the page: status says whether someone is active.
 */
export function EditPersonForm({ person, onDone }: { person: Person; onDone: () => void }) {
  // The result carries PersonSummary, which the cache merges into this person.
  const [updatePerson, { loading, error }] = useUpdatePersonMutation(RELOAD_CONTACT_LISTS)

  const [name, setName] = useState(person.name)
  const [age, setAge] = useState(toText(person.age))
  const [yearMet, setYearMet] = useState(toText(person.yearMet))

  /** Only what the user changed, so a concurrent edit by another shepherd isn't overwritten. */
  function changes(): UpdatePersonInput {
    const input: UpdatePersonInput = {}
    if (name.trim() !== person.name) input.name = name.trim()
    if (toNumber(age) !== person.age) input.age = toNumber(age)
    if (toNumber(yearMet) !== person.yearMet) input.yearMet = toNumber(yearMet)
    return input
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const input = changes()
    if (Object.keys(input).length === 0) {
      onDone()
      return
    }
    try {
      await updatePerson({ variables: { id: person.id, input } })
      onDone()
    } catch {
      // Shown from the mutation's `error` below; the form keeps the input.
    }
  }

  // Emptying Age or Year met sends null, which clears it.
  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.field}>
        Name
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>
            Age <span className={styles.optional}>(optional)</span>
          </span>
          <input
            className={styles.input}
            type="number"
            min={0}
            max={150}
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>
            Year met <span className={styles.optional}>(optional)</span>
          </span>
          <input
            className={styles.input}
            type="number"
            min={1900}
            max={2100}
            value={yearMet}
            onChange={(e) => setYearMet(e.target.value)}
          />
        </label>
      </div>
      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      <div className={styles.actions}>
        <Button variant="secondary" disabled={loading} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading || !name.trim()}>
          {loading ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
