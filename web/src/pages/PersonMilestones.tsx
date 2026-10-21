import { useEffect, useId, useState, type FormEvent } from 'react'
import { Alert, Button, CheckIcon, DateField, Dialog, MILESTONES, TextArea } from '../components'
import { cx } from '../components/utils'
import { friendlyMessage } from '../errors'
import { dateAgo, formatDate, todayIsoDate } from '../format'
import {
  useMilestonesQuery,
  useRecordMilestoneMutation,
  useRemoveMilestoneMutation,
  type PersonQuery,
} from '../generated/graphql'
import { ActionButton } from './ActionButton'
import { milestoneLabel } from './peopleBoard'
import styles from './PersonMilestones.module.css'
import section from './PersonSection.module.css'
import { refetchPerson } from './refetchPerson'

type Person = NonNullable<PersonQuery['person']>
type Recorded = Person['milestones'][number]

/** A step's full name: the dialog title, and the label on phones. */
const FULL_NAMES: Record<(typeof MILESTONES)[number], string> = {
  Baptised: 'Baptised',
  'Small group': 'Joined small group',
  Serving: 'Serving',
  Leading: 'Leading',
}

type Step = {
  key: string
  label: string
  /** Full name, for the Record dialog's title. */
  name: string
  /** The milestone type to record; unknown until the Milestones query loads. */
  typeId: string | undefined
  record: Recorded | undefined
}

/** The milestone being recorded in the dialog. */
type Recording = { id: string; name: string }

/**
 * The Milestones section: the four steps in fixed order, recorded in any order, and any other
 * milestone the API has listed below them. A person may have recorded none (business rule 2).
 */
export function PersonMilestones({ person, narrow }: { person: Person; narrow: boolean }) {
  const { data } = useMilestonesQuery()
  const types = data?.milestones ?? []
  const [recording, setRecording] = useState<Recording | null>(null)
  const headingId = useId()

  const steps: Step[] = MILESTONES.map((label) => ({
    key: label,
    label: narrow ? FULL_NAMES[label] : label,
    name: FULL_NAMES[label],
    typeId: types.find((t) => milestoneLabel(t.name) === label)?.id,
    record: person.milestones.find((m) => milestoneLabel(m.milestone.name) === label),
  }))
  const done = steps.filter((s) => s.record).length

  // Not one of the four (configurable milestones are a later change): listed, not dropped.
  const otherNames = new Map<string, string>()
  for (const t of types) if (!milestoneLabel(t.name)) otherNames.set(t.id, t.name)
  for (const m of person.milestones) {
    if (!milestoneLabel(m.milestone.name)) otherNames.set(m.milestone.id, m.milestone.name)
  }
  const others: Step[] = [...otherNames].map(([id, name]) => ({
    key: id,
    label: name,
    name,
    typeId: id,
    record: person.milestones.find((m) => m.milestone.id === id),
  }))

  const item = (step: Step) => (
    <StepItem
      key={step.key}
      step={step}
      personId={person.id}
      narrow={narrow}
      onRecord={(id) => setRecording({ id, name: step.name })}
    />
  )

  return (
    <section className={section.card} aria-labelledby={headingId}>
      <div className={section.head}>
        <h2 id={headingId} className={section.title}>
          Milestones
        </h2>
        <span className={section.count}>
          {done} of {MILESTONES.length}
        </span>
      </div>
      <ol className={narrow ? styles.timeline : styles.journey}>{steps.map(item)}</ol>
      {others.length > 0 && (
        <>
          <h3 className={styles.othersTitle}>Other milestones</h3>
          <ul className={styles.others}>{others.map(item)}</ul>
        </>
      )}
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
  onRecord: (typeId: string) => void
}) {
  const { record, typeId } = step
  return (
    <li className={cx(styles.step, record !== undefined && styles.done)}>
      {/* A bar segment on the web, a dot on phones' timeline; the words carry the state. */}
      <span className={styles.marker} aria-hidden="true">
        {record && <CheckIcon size={12} className={styles.tick} />}
      </span>
      <div className={styles.body}>
        <div className={styles.label}>{step.label}</div>
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
            <RemoveMilestoneButton
              personId={personId}
              milestoneId={record.milestone.id}
              label={step.label}
            />
          </>
        ) : (
          typeId && (
            <Button
              variant="secondary"
              className={styles.record}
              aria-label={narrow ? `Record milestone: ${step.label}` : `Record ${step.label}`}
              onClick={() => onRecord(typeId)}
            >
              {narrow ? 'Record milestone' : 'Record'}
            </Button>
          )
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
    <ActionButton
      label="Remove"
      ariaLabel={`Remove ${label}`}
      question="Remove this milestone?"
      confirmLabel="Yes, remove"
      loading={loading}
      error={error}
      onClick={() => removeMilestone({ variables: { personId, milestoneId } })}
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
