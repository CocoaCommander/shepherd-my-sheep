import { MockedProvider, type MockedResponse } from '@apollo/client/testing'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphQLError } from 'graphql'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatShortDate } from '../format'
import * as G from '../generated/graphql'
import { useLogContactToast } from './contactToast'
import { LogContactDialog } from './LogContactDialog'
import type { LogContactPerson } from './LogContactForm'

const DAY = 86_400_000
// A Wednesday morning, local time.
const NOW = new Date(2026, 9, 14, 9, 41, 7)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

const ACTIVE = { __typename: 'Status', id: 'st-active', name: 'active' }
const NEW = { __typename: 'Status', id: 'st-new', name: 'new contact' }
const INACTIVE = { __typename: 'Status', id: 'st-inactive', name: 'inactive' }

const MARIA: LogContactPerson = { id: 'p-maria', name: 'Maria Santos', status: ACTIVE }

function contact(id: string, contactedAt: string, createdAt: string) {
  return { __typename: 'ContactLog', id, contactedAt, isFollowUp: false, createdAt }
}

/** The person as the API returns them after a contact. */
function logged(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Person',
    id: MARIA.id,
    name: MARIA.name,
    age: null,
    yearMet: null,
    lastContactedAt: at(0),
    contactDueAt: at(7 * DAY),
    contactClockStart: at(0),
    contactState: G.ContactState.OnTrack,
    isActive: true,
    status: ACTIVE,
    recordedMilestoneIds: [],
    activeBurdenCount: 0,
    latestComment: null,
    shepherds: [],
    prayerBurdens: [],
    comments: [],
    contacts: [contact('c-new', at(0), at(0))],
    ...overrides,
  }
}

function logMock(input: G.LogContactInput, person = logged()) {
  const result = vi.fn(() => ({ data: { logContact: person } }))
  return {
    result,
    mock: { request: { query: G.LogContactDocument, variables: { input } }, result },
  }
}

// The mutations reload both lists; answer them so the refetches don't warn.
const LIST_MOCKS: MockedResponse[] = [
  { request: { query: G.MyPeopleDocument }, result: { data: { myPeople: [] } } },
  { request: { query: G.ContactAlertsDocument }, result: { data: { contactAlerts: [] } } },
].map((m) => ({ ...m, maxUsageCount: Number.POSITIVE_INFINITY }))

/** A host like Home or the Person page: a button opens the dialog; saving closes it and toasts. */
function Host({ person }: { person: LogContactPerson }) {
  const [open, setOpen] = useState(false)
  const { showLogged, toastElement } = useLogContactToast()
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <LogContactDialog
        person={person}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(saved, wasNewContact) => {
          setOpen(false)
          showLogged(saved, wasNewContact)
        }}
      />
      {toastElement}
    </>
  )
}

async function openDialog(person: LogContactPerson = MARIA, mocks: MockedResponse[] = []) {
  const user = userEvent.setup()
  render(
    <MockedProvider mocks={[...mocks, ...LIST_MOCKS]}>
      <Host person={person} />
    </MockedProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'Open' }))
  return user
}

const dateInput = () => screen.getByLabelText('Date of contact (required)')
const commentInput = () => screen.getByLabelText('Comment (required)')
const burdenInput = () => screen.getByLabelText('Prayer burden (optional)')
const save = () => screen.getByRole('button', { name: 'Save contact' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('LogContactDialog', () => {
  it('opens on a form dated today, with the reminder for an active person', async () => {
    await openDialog()
    expect(screen.getByRole('dialog', { name: 'Log contact with Maria' })).toBeInTheDocument()
    expect(
      screen.getByText('We will remind you to contact Maria again 7 days after this date.'),
    ).toBeInTheDocument()
    expect(dateInput()).toHaveValue('2026-10-14')
    expect(dateInput()).toHaveAttribute('max', '2026-10-14')
    expect(dateInput()).toHaveFocus()
    expect(screen.getByText("Saved as a note on Maria's page.")).toBeInTheDocument()
    expect(screen.getByText("Added to Maria's prayer burdens.")).toBeInTheDocument()
  })

  it('tells a new contact this moves them to Active', async () => {
    await openDialog({ ...MARIA, status: NEW })
    expect(
      screen.getByText(
        'Logging this contact moves Maria to Active. After that, we will remind you to contact them every 7 days.',
      ),
    ).toBeInTheDocument()
  })

  it("promises no reminder for someone who isn't tracked", async () => {
    await openDialog({ ...MARIA, status: INACTIVE })
    expect(screen.queryByText(/remind you/)).not.toBeInTheDocument()
  })

  it('asks for a date and a comment, and clears each error as it is fixed', async () => {
    const user = await openDialog()
    fireEvent.change(dateInput(), { target: { value: '' } })
    await user.click(save())

    expect(screen.getByText('Choose the date of the contact.')).toBeInTheDocument()
    expect(screen.getByText('Add a comment on what you talked about.')).toBeInTheDocument()
    expect(dateInput()).toHaveAttribute('aria-invalid', 'true')
    expect(dateInput()).toHaveFocus()

    await user.type(commentInput(), 'Coffee')
    expect(screen.queryByText('Add a comment on what you talked about.')).not.toBeInTheDocument()
    expect(screen.getByText('Choose the date of the contact.')).toBeInTheDocument()

    fireEvent.change(dateInput(), { target: { value: '2026-10-13' } })
    expect(screen.queryByText('Choose the date of the contact.')).not.toBeInTheDocument()
  })

  it('rejects a future date and a blank comment', async () => {
    const user = await openDialog()
    fireEvent.change(dateInput(), { target: { value: '2026-10-15' } })
    await user.type(commentInput(), '   ')
    await user.click(save())

    expect(screen.getByText("The date can't be in the future.")).toBeInTheDocument()
    expect(screen.getByText('Add a comment on what you talked about.')).toBeInTheDocument()
  })

  it("logs today's contact at the current time, without isFollowUp or a blank burden", async () => {
    const { mock, result } = logMock({
      personId: MARIA.id,
      contactedAt: NOW.toISOString(),
      note: 'Talked about her new job',
    })
    const user = await openDialog(MARIA, [mock])
    await user.type(commentInput(), '  Talked about her new job ')
    await user.type(burdenInput(), '   ')
    await user.click(save())

    expect(
      await screen.findByText(
        `Contact logged with Maria. Next contact due ${formatShortDate(at(7 * DAY))}.`,
      ),
    ).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('logs an earlier date at noon that day, with the trimmed burden', async () => {
    const { mock, result } = logMock({
      personId: MARIA.id,
      contactedAt: new Date(2026, 9, 10, 12).toISOString(),
      note: 'Met at church',
      prayerBurden: 'Her mother is ill',
    })
    const user = await openDialog(MARIA, [mock])
    fireEvent.change(dateInput(), { target: { value: '2026-10-10' } })
    await user.type(commentInput(), 'Met at church')
    await user.type(burdenInput(), ' Her mother is ill ')
    await user.click(save())

    expect(await screen.findByText(/^Contact logged with Maria\./)).toBeInTheDocument()
    expect(result).toHaveBeenCalledTimes(1)
  })

  it('says a new contact is now Active', async () => {
    const { mock } = logMock(
      { personId: MARIA.id, contactedAt: NOW.toISOString(), note: 'Followed up' },
      logged({ contacts: [{ ...contact('c-new', at(0), at(0)), isFollowUp: true }] }),
    )
    const user = await openDialog({ ...MARIA, status: NEW }, [mock])
    await user.type(commentInput(), 'Followed up')
    await user.click(save())

    expect(
      await screen.findByText(
        `Contact logged with Maria. Maria is now Active. Next contact due ${formatShortDate(at(7 * DAY))}.`,
      ),
    ).toBeInTheDocument()
  })

  it('Undo deletes the contact just logged, even when it was back-dated', async () => {
    // contacts come newest contactedAt first, so the back-dated one isn't first.
    const { mock } = logMock(
      {
        personId: MARIA.id,
        contactedAt: new Date(2026, 9, 10, 12).toISOString(),
        note: 'Back-dated',
      },
      logged({
        contacts: [
          contact('c-yesterday', at(-DAY), at(-DAY)),
          contact('c-new', new Date(2026, 9, 10, 12).toISOString(), at(0)),
        ],
      }),
    )
    const undone = vi.fn(() => ({
      data: { deleteContact: logged({ contacts: [contact('c-yesterday', at(-DAY), at(-DAY))] }) },
    }))
    const user = await openDialog(MARIA, [
      mock,
      { request: { query: G.DeleteContactDocument, variables: { id: 'c-new' } }, result: undone },
    ])
    fireEvent.change(dateInput(), { target: { value: '2026-10-10' } })
    await user.type(commentInput(), 'Back-dated')
    await user.click(save())
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Contact with Maria removed.')).toBeInTheDocument()
    expect(undone).toHaveBeenCalledTimes(1)
  })

  it('says when Undo fails', async () => {
    const { mock } = logMock({ personId: MARIA.id, contactedAt: NOW.toISOString(), note: 'Hi' })
    const user = await openDialog(MARIA, [
      mock,
      {
        request: { query: G.DeleteContactDocument, variables: { id: 'c-new' } },
        result: {
          errors: [new GraphQLError('Contact not found', { extensions: { code: 'NOT_FOUND' } })],
        },
      },
    ])
    await user.type(commentInput(), 'Hi')
    await user.click(save())
    await user.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(
      await screen.findByText("Couldn't undo. This was changed or removed by someone else."),
    ).toBeInTheDocument()
  })

  it('keeps the dialog open and shows a server error', async () => {
    const user = await openDialog(MARIA, [
      {
        request: {
          query: G.LogContactDocument,
          variables: { input: { personId: MARIA.id, contactedAt: NOW.toISOString(), note: 'Hi' } },
        },
        result: {
          errors: [
            new GraphQLError('Note must not be blank', { extensions: { code: 'BAD_USER_INPUT' } }),
          ],
        },
      },
    ])
    await user.type(commentInput(), 'Hi')
    await user.click(save())

    expect(await screen.findByText('Note must not be blank')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes without saving on Cancel, the close button and Escape, and starts fresh', async () => {
    const user = await openDialog()
    await user.type(commentInput(), 'Unsaved')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(commentInput()).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
