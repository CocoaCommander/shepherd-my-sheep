import { Alert, Button, DueTag } from '../components'
import { contactDueLabel } from '../format'
import type { ContactState } from '../generated/graphql'
import styles from './ContactStatusBanner.module.css'

/**
 * Where the person stands against the contact rule (business rule 6), with the Log contact
 * button. Overdue is an Alert; due soon and on track are a DueTag; people who aren't tracked
 * get the button alone. The tone always comes with an icon and words, never colour alone.
 */
export function ContactStatusBanner({
  person,
  now,
  onLogContact,
}: {
  person: { status: { name: string }; contactState: ContactState; contactDueAt?: string | null }
  now?: Date
  onLogContact: () => void
}) {
  const due = contactDueLabel(person, now)
  const button = (
    <Button
      variant={due?.tone === 'overdue' ? 'danger' : due ? 'primary' : 'secondary'}
      onClick={onLogContact}
    >
      Log contact
    </Button>
  )

  if (!due) return <div className={styles.untracked}>{button}</div>

  if (due.tone === 'overdue') {
    return (
      <Alert title={due.title} action={button}>
        {due.detail}
      </Alert>
    )
  }

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <DueTag tone={due.tone}>{due.title}</DueTag>
        {due.detail && <span>{due.detail}</span>}
      </div>
      {button}
    </div>
  )
}
