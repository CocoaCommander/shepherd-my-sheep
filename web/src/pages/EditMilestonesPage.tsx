import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { ApolloError } from '@apollo/client'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  CheckIcon,
  ChevronLeftIcon,
  Dialog,
  PlusIcon,
  TextArea,
  TextField,
  useUndoToast,
  WarningIcon,
} from '../components'
import { cx } from '../components/utils'
import { errorCode, friendlyMessage, GENERIC_MESSAGE } from '../errors'
import {
  useCreateMilestoneMutation,
  useDeleteMilestoneMutation,
  useMilestonesQuery,
  useRestoreMilestoneMutation,
  useUpdateMilestoneMutation,
  type MilestoneFieldsFragment,
} from '../generated/graphql'
import { NARROW, useMediaQuery } from '../useMediaQuery'
import styles from './EditMilestonesPage.module.css'
import { Header } from './Header'
import { descriptionError, MAX_NAME, nameError, people, recordedText } from './milestoneRules'

type Milestone = MilestoneFieldsFragment

/** Every change refetches the list, so counts and A-to-Z order stay the server's. */
const REFETCH_MILESTONES = { refetchQueries: ['Milestones'], awaitRefetchQueries: true }

/**
 * The shared milestone list (business rule 7): add, rename, describe and delete, for every
 * shepherd and every person. Delete can be undone from the toast. The list may be empty.
 */
export function EditMilestonesPage() {
  const narrow = useMediaQuery(NARROW)
  // Refetched on every visit: the delete dialog reads its count from here.
  const { data, loading, error, refetch } = useMilestonesQuery({
    fetchPolicy: 'cache-and-network',
  })
  const milestones = data?.milestones
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Milestone | null>(null)
  // The control that gets focus back once its form or dialog has gone.
  const [refocus, setRefocus] = useState<string | null>(null)
  const listHeading = useRef<HTMLHeadingElement>(null)
  const { show, toastElement } = useUndoToast({ floating: true, className: styles.toast })
  const [restoreMilestone] = useRestoreMilestoneMutation(REFETCH_MILESTONES)

  useEffect(() => {
    if (!refocus) return
    const target =
      refocus === 'list'
        ? listHeading.current
        : document.querySelector<HTMLElement>(`[data-edit-for="${refocus}"]`)
    target?.focus()
    setRefocus(null)
  }, [refocus, milestones])

  function closeEdit(id: string) {
    setEditingId(null)
    setRefocus(id)
  }

  function deleted(milestone: Milestone) {
    setDeleting(null)
    setRefocus('list')
    show(`Deleted “${milestone.name}”.`, () => {
      restoreMilestone({ variables: { id: milestone.id } }).catch((e: unknown) => {
        // Gone for good (over an hour) or its name taken since: say so where Undo was.
        show(
          e instanceof ApolloError ? friendlyMessage(e) : `Couldn't restore “${milestone.name}”.`,
        )
      })
    })
  }

  const count = milestones?.length ?? 0

  return (
    <div className={styles.page}>
      <Header />
      {toastElement}
      <main className={styles.main}>
        <BackLink />
        <div>
          <h1 className={styles.title}>Edit milestones</h1>
          <p className={styles.lead}>
            Shared by everyone in Shepherd My Sheep. A change shows on every person&apos;s page and
            for every shepherd.
          </p>
        </div>

        <div className={styles.layout}>
          <section className={styles.listCard} aria-labelledby="milestone-list-title">
            <div className={styles.listHead}>
              <h2
                ref={listHeading}
                id="milestone-list-title"
                tabIndex={-1}
                className={styles.cardTitle}
              >
                {milestones ? (count === 1 ? '1 milestone' : `${count} milestones`) : 'Milestones'}
              </h2>
              <span className={styles.sorted}>{narrow ? 'A to Z' : 'Sorted A to Z'}</span>
            </div>
            {loading && !data && <p className={styles.muted}>Loading…</p>}
            {error && !data && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
            {milestones && count === 0 && (
              <div className={styles.empty}>
                <strong>No milestones yet</strong>
                <span>
                  {narrow ? 'Add the first one below.' : 'Add the first one with the form.'}
                </span>
              </div>
            )}
            {milestones && count > 0 && (
              <ul className={styles.rows}>
                {milestones.map((m) => (
                  <li key={m.id} className={styles.row}>
                    {editingId === m.id ? (
                      <EditMilestoneForm
                        milestone={m}
                        list={milestones}
                        narrow={narrow}
                        onDone={(saved) => {
                          closeEdit(m.id)
                          if (saved) {
                            show(
                              narrow
                                ? `Saved “${saved.name}”.`
                                : `Saved “${saved.name}”. Every person page now shows the new wording.`,
                            )
                          }
                        }}
                        onGone={() => {
                          setEditingId(null)
                          setRefocus('list')
                          void refetch()
                        }}
                      />
                    ) : (
                      <MilestoneRow
                        milestone={m}
                        narrow={narrow}
                        onEdit={() => setEditingId(m.id)}
                        onDelete={() => {
                          setEditingId(null)
                          setDeleting(m)
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className={styles.aside}>
            <AddMilestoneCard
              list={milestones ?? []}
              narrow={narrow}
              onAdded={(added) =>
                show(
                  narrow
                    ? `Added “${added.name}”.`
                    : `Added “${added.name}”. It shows as not yet reached for everyone.`,
                )
              }
            />
            <div className={styles.how}>
              <strong>How milestones work</strong>
              <span>They can be reached in any order, so there is no step order to set.</span>
              <span>A new milestone starts as not yet reached for everyone.</span>
            </div>
          </aside>
        </div>
      </main>

      <DeleteMilestoneDialog
        milestone={deleting}
        // The dialog gives focus back to the Delete button on Cancel.
        onClose={() => setDeleting(null)}
        onDeleted={deleted}
        onGone={() => void refetch()}
      />
    </div>
  )
}

/**
 * Back to wherever the page was opened from (the person page, for now); straight to My people
 * when it was opened directly. The Milestones view will take this over.
 */
function BackLink() {
  const navigate = useNavigate()
  const location = useLocation()
  const hasHistory = location.key !== 'default'

  return (
    <Link
      to="/people"
      className={styles.back}
      onClick={(e: MouseEvent) => {
        if (!hasHistory) return
        e.preventDefault()
        navigate(-1)
      }}
    >
      <ChevronLeftIcon size={16} />
      Back
    </Link>
  )
}

function MilestoneRow({
  milestone,
  narrow,
  onEdit,
  onDelete,
}: {
  milestone: Milestone
  narrow: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className={cx(styles.view, narrow && styles.viewNarrow)}>
      {!narrow && (
        <span className={styles.icon} aria-hidden="true">
          <CheckIcon size={16} />
        </span>
      )}
      <div className={styles.what}>
        <div className={styles.name}>{milestone.name}</div>
        <div className={styles.description}>{milestone.description ?? 'No description'}</div>
        {narrow && <div className={styles.count}>{recordedText(milestone.recordedCount)}</div>}
      </div>
      {!narrow && <span className={styles.count}>{recordedText(milestone.recordedCount)}</span>}
      <div className={styles.rowActions}>
        <Button
          variant="secondary"
          data-edit-for={milestone.id}
          aria-label={`Edit ${milestone.name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          className={styles.deleteButton}
          aria-label={`Delete ${milestone.name}`}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

type Values = { name: string; description: string }
type Errors = {
  name?: string
  description?: string
  form?: string
  /** NOT_FOUND: someone else deleted it meanwhile. */
  gone?: boolean
}

/**
 * Splits a failed save: the server's BAD_USER_INPUT and CONFLICT messages go under their field
 * (another shepherd may have taken the name since the list loaded); anything else above.
 */
function serverErrors(e: unknown): Errors {
  if (!(e instanceof ApolloError)) return { form: GENERIC_MESSAGE }
  const code = errorCode(e)
  const message = friendlyMessage(e)
  if (code === 'BAD_USER_INPUT' || code === 'CONFLICT') {
    return /description/i.test(message) ? { description: message } : { name: message }
  }
  return { form: message, gone: code === 'NOT_FOUND' }
}

/** The name and description fields, shared by Add and Edit. Checks the list before sending. */
function MilestoneFields({
  idPrefix,
  values,
  errors,
  nameHelp,
  descriptionHelp,
  descriptionRows,
  onChange,
}: {
  idPrefix: string
  values: Values
  errors: Errors
  nameHelp: string
  descriptionHelp?: string
  descriptionRows: number
  onChange: (values: Values, cleared: keyof Errors) => void
}) {
  return (
    <>
      {errors.form && <Alert variant="inline">{errors.form}</Alert>}
      <TextField
        id={`${idPrefix}-name`}
        label="Name"
        required
        autoComplete="off"
        maxLength={MAX_NAME}
        value={values.name}
        help={nameHelp}
        error={errors.name}
        onChange={(e) => onChange({ ...values, name: e.target.value }, 'name')}
      />
      <TextArea
        id={`${idPrefix}-description`}
        label="Description"
        required={false}
        rows={descriptionRows}
        value={values.description}
        help={descriptionHelp}
        error={errors.description}
        onChange={(e) => onChange({ ...values, description: e.target.value }, 'description')}
      />
    </>
  )
}

/** Shared state and submit flow: check, focus the first problem, send, show server errors. */
function useMilestoneForm(
  idPrefix: string,
  initial: Values,
  check: (values: Values) => Errors,
  send: (values: Values) => Promise<void>,
) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const focus = (found: Errors) => {
    const field = found.name ? 'name' : found.description ? 'description' : undefined
    if (field) document.getElementById(`${idPrefix}-${field}`)?.focus()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const found = check(values)
    setErrors(found)
    if (found.name || found.description) {
      focus(found)
      return
    }
    setBusy(true)
    try {
      await send(values)
    } catch (err) {
      const fromServer = serverErrors(err)
      setErrors(fromServer)
      focus(fromServer)
    } finally {
      setBusy(false)
    }
  }

  return {
    values,
    errors,
    busy,
    submit,
    setValues,
    onChange: (next: Values, cleared: keyof Errors) => {
      setValues(next)
      setErrors((prev) => ({ ...prev, [cleared]: undefined, form: undefined }))
    },
  }
}

const checkFor =
  (list: readonly Milestone[], exceptId?: string) =>
  (values: Values): Errors => ({
    name: nameError(values.name, list, exceptId),
    description: descriptionError(values.description),
  })

function AddMilestoneCard({
  list,
  narrow,
  onAdded,
}: {
  list: readonly Milestone[]
  narrow: boolean
  onAdded: (added: Milestone) => void
}) {
  const idPrefix = useId()
  const [createMilestone] = useCreateMilestoneMutation(REFETCH_MILESTONES)
  const form = useMilestoneForm(
    idPrefix,
    { name: '', description: '' },
    checkFor(list),
    async ({ name, description }) => {
      const result = await createMilestone({
        variables: { input: { name: name.trim(), description: description.trim() || null } },
      })
      form.setValues({ name: '', description: '' })
      if (result.data) onAdded(result.data.createMilestone)
    },
  )

  return (
    <section className={styles.card} aria-labelledby={`${idPrefix}-title`}>
      <form noValidate onSubmit={form.submit} className={styles.form}>
        <h2 id={`${idPrefix}-title`} className={styles.cardTitle}>
          Add a milestone
        </h2>
        <MilestoneFields
          idPrefix={idPrefix}
          values={form.values}
          errors={form.errors}
          nameHelp="Each name must be different. Up to 100 characters."
          descriptionHelp={narrow ? undefined : 'Helps shepherds know when to record it.'}
          descriptionRows={3}
          onChange={form.onChange}
        />
        <Button type="submit" size="lg" icon={<PlusIcon />} disabled={form.busy}>
          {form.busy ? 'Adding…' : 'Add milestone'}
        </Button>
      </form>
    </section>
  )
}

function EditMilestoneForm({
  milestone,
  list,
  narrow,
  onDone,
  onGone,
}: {
  milestone: Milestone
  list: readonly Milestone[]
  narrow: boolean
  /** With the saved milestone, or nothing on Cancel. */
  onDone: (saved?: Milestone) => void
  /** Someone else deleted it meanwhile. */
  onGone: () => void
}) {
  const idPrefix = useId()
  const [updateMilestone] = useUpdateMilestoneMutation(REFETCH_MILESTONES)
  const form = useMilestoneForm(
    idPrefix,
    { name: milestone.name, description: milestone.description ?? '' },
    checkFor(list, milestone.id),
    async ({ name, description }) => {
      // A blank description clears it (UpdateMilestoneInput).
      const result = await updateMilestone({
        variables: {
          id: milestone.id,
          input: { name: name.trim(), description: description.trim() || null },
        },
      })
      if (result.data) onDone(result.data.updateMilestone)
    },
  )

  // Focus the name on open, as the canvas's inline form does.
  useEffect(() => {
    document.getElementById(`${idPrefix}-name`)?.focus()
  }, [idPrefix])

  return (
    <form
      noValidate
      onSubmit={form.submit}
      aria-label={`Edit ${milestone.name}`}
      className={cx(styles.form, styles.editForm, narrow && styles.editNarrow)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone()
      }}
    >
      <MilestoneFields
        idPrefix={idPrefix}
        values={form.values}
        errors={form.errors}
        nameHelp="Up to 100 characters. Renaming keeps every date already recorded."
        descriptionRows={2}
        onChange={form.onChange}
      />
      <div className={styles.formActions}>
        {form.errors.gone ? (
          <Button variant="secondary" onClick={onGone}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" disabled={form.busy} onClick={() => onDone()}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.busy}>
              {form.busy ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        )}
      </div>
    </form>
  )
}

function DeleteMilestoneDialog({
  milestone,
  onClose,
  onDeleted,
  onGone,
}: {
  milestone: Milestone | null
  onClose: () => void
  onDeleted: (milestone: Milestone) => void
  /** Someone else deleted it meanwhile. */
  onGone: () => void
}) {
  const [deleteMilestone, { loading, error, reset }] =
    useDeleteMilestoneMutation(REFETCH_MILESTONES)
  async function confirm() {
    if (!milestone || loading) return
    try {
      await deleteMilestone({ variables: { id: milestone.id } })
      onDeleted(milestone)
    } catch (e) {
      if (e instanceof ApolloError && errorCode(e) === 'NOT_FOUND') onGone()
    }
  }

  const close = () => {
    if (loading) return
    reset()
    onClose()
  }

  const count = milestone?.recordedCount ?? 0
  return (
    <Dialog
      open={milestone !== null}
      alert
      onClose={close}
      title={`Delete “${milestone?.name ?? ''}”?`}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" disabled={loading} onClick={confirm}>
            {loading ? 'Deleting…' : 'Delete milestone'}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        {count > 0 ? (
          <p className={styles.warning}>
            <WarningIcon size={16} className={styles.warningIcon} />
            <span>
              Recorded for {people(count)}. Their dates and notes for this milestone will be deleted
              too.
            </span>
          </p>
        ) : (
          <p className={styles.dialogText}>Nobody has this milestone recorded yet.</p>
        )}
        <p className={styles.dialogText}>
          It will be removed for every shepherd and every person. You can undo for a few seconds
          after deleting.
        </p>
        {error && <Alert variant="inline">{friendlyMessage(error)}</Alert>}
      </div>
    </Dialog>
  )
}
