import { useId, useState } from 'react'
import { Button, Dialog } from '../components'
import { firstName } from '../format'
import type { LoggedPerson } from './contactToast'
import { LogContactForm, type LogContactPerson } from './LogContactForm'
import styles from './LogContactForm.module.css'

/**
 * The Log contact dialog. The form mounts only while it's open, so it starts empty each time.
 * On save, the host closes it and shows the toast (useLogContactToast).
 */
export function LogContactDialog({
  person,
  open,
  onClose,
  onSaved,
}: {
  person: LogContactPerson
  open: boolean
  onClose: () => void
  onSaved: (person: LoggedPerson, wasNewContact: boolean) => void
}) {
  const formId = useId()
  const [busy, setBusy] = useState(false)
  const first = firstName(person.name)
  // Inactive and lost-contact people aren't tracked (business rule 6), so they get no reminder.
  const intro =
    person.status.name === 'new contact'
      ? `Logging this contact moves ${first} to Active. After that, we will remind you to contact them every 7 days.`
      : person.status.name === 'active'
        ? `We will remind you to contact ${first} again 7 days after this date.`
        : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Log contact with ${first}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? 'Saving…' : 'Save contact'}
          </Button>
        </>
      }
    >
      {intro && <p className={styles.intro}>{intro}</p>}
      <LogContactForm id={formId} person={person} onSaved={onSaved} onBusyChange={setBusy} />
    </Dialog>
  )
}
