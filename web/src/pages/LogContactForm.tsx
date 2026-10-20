import { useEffect, useId, useState, type FormEvent } from 'react'
import { Alert, Button, DateField, TextArea, TextField } from '../components'
import { friendlyMessage } from '../errors'
import { contactDateToTimestamp, firstName, todayIsoDate } from '../format'
import { useLogContactMutation, type LogContactInput } from '../generated/graphql'
import { RELOAD_CONTACT_LISTS, type LoggedPerson } from './contactToast'
import styles from './LogContactForm.module.css'

/** Just what the form needs, so Home's summaries and the Person page's detail both fit. */
export type LogContactPerson = { id: string; name: string; status: { name: string } }

type Errors = { date?: string; note?: string }

/**
 * Logs a contact: its date, a required comment (saved as a note) and an optional prayer
 * burden. Validates on submit only; editing a field clears its error.
 *
 * Give it `submitLabel` to render its own buttons. Otherwise the host renders them, with
 * `type="submit" form={id}` on the submit button, and can follow the save via onBusyChange.
 */
export function LogContactForm({
  id,
  person,
  submitLabel,
  secondary,
  onSaved,
  onBusyChange,
}: {
  id?: string
  person: LogContactPerson
  submitLabel?: string
  /** e.g. "Skip for now", beside the submit button. Only with submitLabel. */
  secondary?: { label: string; onClick: () => void }
  /**
   * wasNewContact: they were a new contact before this, so the contact was their follow-up.
   * withBurden: a prayer burden was added with it.
   */
  onSaved: (person: LoggedPerson, wasNewContact: boolean, saved: { withBurden: boolean }) => void
  onBusyChange?: (busy: boolean) => void
}) {
  const autoId = useId()
  const formId = id ?? autoId
  const first = firstName(person.name)
  // The date the form opened on; the check on submit uses the time then.
  const [today] = useState(() => todayIsoDate())
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [burden, setBurden] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [logContact, { loading, error }] = useLogContactMutation(RELOAD_CONTACT_LISTS)

  useEffect(() => {
    onBusyChange?.(loading)
    return () => onBusyChange?.(false)
  }, [loading, onBusyChange])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    const now = new Date()
    const found: Errors = {
      date: !date
        ? 'Choose the date of the contact.'
        : date > todayIsoDate(now)
          ? "The date can't be in the future."
          : undefined,
      note: note.trim() ? undefined : 'Add a comment on what you talked about.',
    }
    setErrors(found)
    if (found.date || found.note) {
      document.getElementById(`${formId}-${found.date ? 'date' : 'note'}`)?.focus()
      return
    }

    const wasNewContact = person.status.name === 'new contact'
    const prayerBurden = burden.trim()
    // isFollowUp is deprecated and ignored: any contact for a new contact is their follow-up.
    const input: LogContactInput = {
      personId: person.id,
      contactedAt: contactDateToTimestamp(date, now),
      note: note.trim(),
      ...(prayerBurden && { prayerBurden }),
    }
    try {
      const result = await logContact({ variables: { input } })
      if (result.data) {
        onSaved(result.data.logContact, wasNewContact, { withBurden: Boolean(prayerBurden) })
      }
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form id={formId} noValidate onSubmit={submit} className={styles.form}>
      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      <DateField
        id={`${formId}-date`}
        label="Date of contact"
        required
        value={date}
        max={today}
        error={errors.date}
        help="Set to today from your device. Change it if you met earlier."
        onChange={(e) => {
          setDate(e.target.value)
          setErrors((prev) => ({ ...prev, date: undefined }))
        }}
      />
      <TextArea
        id={`${formId}-note`}
        label="Comment"
        required
        placeholder="What did you talk about?"
        value={note}
        error={errors.note}
        help={`Saved as a note on ${first}'s page.`}
        onChange={(e) => {
          setNote(e.target.value)
          setErrors((prev) => ({ ...prev, note: undefined }))
        }}
      />
      <TextField
        label="Prayer burden"
        required={false}
        value={burden}
        help={`Added to ${first}'s prayer burdens.`}
        onChange={(e) => setBurden(e.target.value)}
      />
      {submitLabel && (
        <div className={styles.actions}>
          {secondary && (
            <Button variant="secondary" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving…' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
