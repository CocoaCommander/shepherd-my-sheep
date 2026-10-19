import { render } from '@testing-library/react'
import axe from 'axe-core'
import type { ReactNode } from 'react'
import { Link, MemoryRouter, NavLink } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import * as C from '..'

/**
 * Runs axe-core's WCAG 2.2 A/AA and best-practice rules over every component and variant.
 * Colour contrast can't be measured in jsdom (no layout), so it isn't covered here; the token
 * pairs were checked by hand against 4.5:1 for text and 3:1 for UI (see tokens.css).
 */
async function violations(ui: ReactNode) {
  const { container } = render(<MemoryRouter>{ui}</MemoryRouter>)
  const results = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)
}

const noop = () => {}

describe('accessibility (axe-core, WCAG 2.2 A/AA)', () => {
  it('header, actions and feedback', async () => {
    expect(
      await violations(
        <>
          <C.AppHeader
            brand={<C.Brand as={Link} to="/" />}
            nav={
              <>
                <NavLink to="/" end>
                  My people
                </NavLink>
                <NavLink to="/prayer">Prayer list</NavLink>
              </>
            }
            alerts={<C.Bell count={4} label="4 people need contacting" />}
            actions={
              <>
                <span>Daniel Okafor</span>
                <C.Button variant="text">Sign out</C.Button>
              </>
            }
          />
          <main>
            <h1>Home</h1>
            <C.Button icon={<C.PlusIcon />}>Add person</C.Button>
            <C.Button variant="secondary">Add note</C.Button>
            <C.Button variant="danger">Contacted today</C.Button>
            <C.Button as={Link} to="/x" variant="secondary">
              Open
            </C.Button>
            <C.Toast message="Prayer released." actionLabel="Undo" onAction={noop} />
            <C.Alert
              title="4 people are overdue"
              action={<C.Button variant="danger">Review now</C.Button>}
            >
              Elena Petrova has gone 21 days.
            </C.Alert>
            <C.Alert variant="inline">That username or password is not right.</C.Alert>
            <C.Alert variant="success">Account created.</C.Alert>
            <C.StatTile
              href="#overdue"
              tone="danger"
              count={4}
              label="Overdue"
              rule="Alert raised"
            />
          </main>
        </>,
      ),
    ).toEqual([])
  })

  it('status, avatars and progress', async () => {
    expect(
      await violations(
        <main>
          {(['new', 'active', 'inactive', 'lost'] as const).map((s) => (
            <C.StatusPill key={s} status={s} />
          ))}
          <C.DueTag tone="overdue">14 days overdue</C.DueTag>
          <C.DueTag tone="soon">Due in 2 days</C.DueTag>
          <C.DueTag tone="ok">On track</C.DueTag>
          <C.CountPill count={4} tone="danger" />
          <C.Avatar name="Maria Santos" tint="sand" />
          <C.AvatarStack
            names={['Daniel Okafor', 'Grace Lin']}
            label="Shepherded by you and one other"
          />
          <C.Meter
            value={21}
            max={7}
            tone="danger"
            label="21 days since last contact"
            goal="Goal: every 7 days"
          />
          <C.Milestones recorded={['Baptised']} />
          <C.Milestones recorded={[]} compact />
          <C.Stepper current={2} total={4} />
          <C.InsetNote label="Last note, 3 weeks ago">Text her.</C.InsetNote>
          <C.MilestoneTag done>Serving</C.MilestoneTag>
          <C.MilestoneTag>Leading</C.MilestoneTag>
          <C.PrayerCount count={0} hiddenSuffix=" praying" />
        </main>,
      ),
    ).toEqual([])
  })

  it('forms and filters', async () => {
    expect(
      await violations(
        <main>
          <form>
            <C.TextField
              label="Username"
              help="Letters, numbers and dots."
              autoComplete="username"
            />
            <C.PasswordField
              label="Password"
              help="At least 8 characters."
              autoComplete="current-password"
            />
            <C.TextField label="Name" error="Enter your name." />
            <C.TextField label="Full name" required help="As they introduce themselves." />
            <C.DateField label="Date" required max="2026-10-19" />
            <C.TextArea label="Comment" required error="Add a comment on what you talked about." />
            <C.TextArea label="Prayer note" required={false} />
            <C.SearchInput label="Search by name" />
            <C.Select label="Person">
              <option>Everyone</option>
            </C.Select>
          </form>
          <C.Chip pressed count={11}>
            All
          </C.Chip>
          <C.Chip pressed={false} count={2}>
            New contact
          </C.Chip>
          <C.SegmentedControl
            label="Sort"
            value="name"
            onChange={noop}
            options={[
              { value: 'name', label: 'Name' },
              { value: 'date', label: 'Date' },
            ]}
          />
          <C.ViewToggle value="gallery" onChange={noop} />
          <C.Switch checked={false} onChange={noop}>
            Hide details
          </C.Switch>
        </main>,
      ),
    ).toEqual([])
  })

  it('dialog, steps and the undo toast', async () => {
    function UndoToast() {
      const { toastElement } = C.useUndoToast()
      return toastElement
    }
    expect(
      await violations(
        <main>
          <h1>Maria Santos</h1>
          <C.StepsPanel
            items={['Log a contact within 72 hours.', 'Maria moves to Active.', 'Contact weekly.']}
          />
          <UndoToast />
          <C.Dialog
            open
            onClose={noop}
            title="Log contact with Maria"
            footer={
              <>
                <C.Button variant="secondary">Cancel</C.Button>
                <C.Button>Save contact</C.Button>
              </>
            }
          >
            <p>We will remind you to contact Maria again 7 days after this date.</p>
            <C.TextArea label="Comment" required />
          </C.Dialog>
        </main>,
      ),
    ).toEqual([])
  })

  it('cards and board, including empty states', async () => {
    expect(
      await violations(
        <main>
          <h1>My people</h1>
          <C.PersonCard
            name="David Mensah"
            renderName={(n) => <Link to="/people/d1">{n}</Link>}
            headingLevel={2}
            status="active"
            lastContact="1 week ago"
            milestones={['Baptised', 'Serving']}
            shepherds={{ names: ['Daniel Okafor'], label: 'Shepherded by you' }}
            prayerCount={1}
          />
          <C.PersonCard
            name="Tom Becker"
            headingLevel={2}
            status="new"
            milestones={[]}
            prayerCount={0}
          />
          <C.CareCard
            name="Elena Petrova"
            headingLevel={2}
            status="active"
            urgency="overdue"
            dueLabel="14 days overdue"
            meter={{ value: 21, max: 7, label: '21 days since last contact' }}
            note={{ label: 'Last note', content: 'Text her.' }}
            actions={<C.Button variant="danger">Contacted today</C.Button>}
          />
          <C.AddPersonTile href="/people/new" />
          <C.BoardColumn status="active" count={1}>
            <C.MiniPersonCard
              name="Maria Santos"
              lastContact="3 weeks ago"
              overdue
              prayerCount={1}
              milestones={[]}
            />
          </C.BoardColumn>
          <C.BoardColumn status="lost" count={0} />
        </main>,
      ),
    ).toEqual([])
  })
})
