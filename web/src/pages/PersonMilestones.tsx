import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, CheckIcon, DateField, Dialog, TextArea } from '../components'
import { cx } from '../components/utils'
import { friendlyMessage } from '../errors'
import { dateAgo, formatDate, todayIsoDate } from '../format'
import {
  useMilestonesQuery,
  useRecordMilestoneMutation,
  useRemoveMilestoneMutation,
  type PersonQuery,
} from '../generated/graphql'
import { ConfirmButton } from './ConfirmButton'
import styles from './PersonMilestones.module.css'
import section from './PersonSection.module.css'
import { refetchPerson } from './refetchPerson'

type Person = NonNullable<PersonQuery['person']>
type Recorded = Person['milestones'][number]

type Step = {
  /** The milestone's id, to record it. */
  id: string
  name: string
  record: Recorded | undefined
}

/** The milestone being recorded in the dialog. */
type Recording = { id: string; name: string }

/** Where the shared list is edited (business rule 7). */
export const EDIT_MILESTONES_PATH = '/milestones/edit'

/**
 * The Milestones section: every milestone, A to Z as the API lists them, recorded in any
 * order. The list may be empty (business rule 7) and so may the person's records (rule 2).
 * A record of a milestone that isn't in the list (deleted since) isn't shown.
 */
export function PersonMilestones({ person, narrow }: { person: Person; narrow: boolean }) {
  const { data } = useMilestonesQuery()
  const [recording, setRecording] = useState<Recording | null>(null)
  const headingId = useId()

  const steps: Step[] | undefined = data?.milestones.map((m) => ({
    id: m.id,
    name: m.name,
    record: person.milestones.find((r) => r.milestone.id === m.id),
  }))
  const done = steps?.filter((s) => s.record).length ?? 0

  return (
    <section className={section.card} aria-labelledby={headingId}>
      <div className={section.head}>
        <h2 id={headingId} className={section.title}>
          Milestones
        </h2>
        <div className={styles.headEnd}>
          {/* Nothing until the list loads, rather than "0 of 0". */}
          {steps && steps.length > 0 && (
            <span className={section.count}>
              {done} of {steps.length}
            </span>
          )}
          <Link to={EDIT_MILESTONES_PATH} className={styles.edit}>
            Edit milestones
          </Link>
        </div>
      </div>
      {steps &&
        (steps.length === 0 ? (
          <p className={styles.empty}>No milestones set up yet.</p>
        ) : (
          <ol className={narrow ? styles.timeline : styles.journey}>
            {steps.map((step) => (
              <StepItem
                key={step.id}
                step={step}
                personId={person.id}
                narrow={narrow}
                onRecord={() => setRecording({ id: step.id, name: step.name })}
              />
            ))}
          </ol>
        ))}
      <RecordMilestoneDialog
        personId={person.id}
        milestone={recording}
        onClose={() => setRecording(null)}
      />
    </section>
  )
}

function StepItem({
  step,
  personId,
  narrow,
  onRecord,
}: {
  step: Step
  personId: string
  narrow: boolean
  onRecord: () => void
}) {
  const { record, name } = step
  return (
    <li className={cx(styles.step, record !== undefined && styles.done)}>
      {/* A bar segment on the web, a dot on phones' timeline; the words carry the state. */}
      <span className={styles.marker} aria-hidden="true">
        {record && <CheckIcon size={12} className={styles.tick} />}
      </span>
      <div className={styles.body}>
        <div className={styles.label}>{name}</div>
        {record ? (
          <>
            <div className={styles.when}>
              {record.dateAchieved ? (
                <time dateTime={record.dateAchieved} title={formatDate(record.dateAchieved)}>
                  {capitalise(dateAgo(record.dateAchieved))}
                </time>
              ) : (
                'Date not recorded'
              )}
            </div>
            {record.notes && <p className={styles.note}>{record.notes}</p>}
            <RemoveMilestoneButton personId={personId} milestoneId={step.id} label={name} />
          </>
        ) : (
          <Button
            variant="secondary"
            className={styles.record}
            aria-label={narrow ? `Record milestone: ${name}` : `Record ${name}`}
            onClick={onRecord}
          >
            {narrow ? 'Record milestone' : 'Record'}
          </Button>
        )}
      </div>
    </li>
  )
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function RemoveMilestoneButton({
  personId,
  milestoneId,
  label,
}: {
  personId: string
  milestoneId: string
  label: string
}) {
  const [removeMilestone, { loading, error }] = useRemoveMilestoneMutation(refetchPerson(personId))

  return (
    <ConfirmButton
      label="Remove"
      ariaLabel={`Remove ${label}`}
      title={`Remove ${label}?`}
      body="This removes the milestone, its date and its note for every shepherd."
      confirmLabel="Yes, remove"
      loading={loading}
      error={error}
      onConfirm={() => removeMilestone({ variables: { personId, milestoneId } })}
    />
  )
}

/** Record opens this, titled with the milestone's name; the date and note are both optional. */
function RecordMilestoneDialog({
  personId,
  milestone,
  onClose,
}: {
  personId: string
  milestone: Recording | null
  onClose: () => void
}) {
  const formId = useId()
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={milestone !== null}
      onClose={onClose}
      title={milestone?.name ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? 'Saving…' : 'Record milestone'}
          </Button>
        </>
      }
    >
      {milestone && (
        <RecordMilestoneForm
          id={formId}
          personId={personId}
          milestoneId={milestone.id}
          onBusyChange={setBusy}
          onSaved={onClose}
        />
      )}
    </Dialog>
  )
}

/** Mounts with the dialog, so it starts empty on every open. */
function RecordMilestoneForm({
  id,
  personId,
  milestoneId,
  onBusyChange,
  onSaved,
}: {
  id: string
  personId: string
  milestoneId: string
  onBusyChange: (busy: boolean) => void
  onSaved: () => void
}) {
  const [today] = useState(() => todayIsoDate())
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [dateError, setDateError] = useState<string>()
  const [recordMilestone, { loading, error }] = useRecordMilestoneMutation(refetchPerson(personId))

  useEffect(() => {
    onBusyChange(loading)
    return () => onBusyChange(false)
  }, [loading, onBusyChange])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    if (date && date > todayIsoDate()) {
      setDateError("The date can't be in the future.")
      document.getElementById(`${id}-date`)?.focus()
      return
    }
    try {
      await recordMilestone({
        variables: {
          input: { personId, milestoneId, dateAchieved: date || null, notes: notes.trim() || null },
        },
      })
      onSaved()
    } catch {
      // Shown from the mutation's `error` below.
    }
  }

  return (
    <form id={id} noValidate onSubmit={submit} className={styles.form}>
      {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      <DateField
        id={`${id}-date`}
        label="Date achieved"
        required={false}
        value={date}
        max={today}
        error={dateError}
        onChange={(e) => {
          setDate(e.target.value)
          setDateError(undefined)
        }}
      />
      <TextArea
        label="Note"
        required={false}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </form>
  )
}
