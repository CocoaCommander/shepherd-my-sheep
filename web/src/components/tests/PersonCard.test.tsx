import { fireEvent, render, screen, within } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../Button/Button'
import { AddPersonTile, CareCard, MiniPersonCard, PersonCard } from '../PersonCard/PersonCard'
import styles from '../PersonCard/PersonCard.module.css'
import progress from '../Progress/Progress.module.css'
import shared from '../shared.module.css'

describe('PersonCard', () => {
  it('shows everything about one person', () => {
    render(
      <MemoryRouter>
        <PersonCard
          name="David Mensah"
          renderName={(n) => <Link to="/people/d1">{n}</Link>}
          subtitle="52 years old · Met 2016"
          status="active"
          lastContact="1 week ago"
          milestones={['Baptised', 'Serving', 'Leading']}
          shepherds={{
            names: ['Daniel Okafor', 'Grace Lin'],
            label: 'Shepherded by you and one other',
          }}
          prayerCount={1}
        />
      </MemoryRouter>,
    )
    const card = screen.getByRole('article')
    expect(within(card).getByRole('link', { name: 'David Mensah' })).toHaveAttribute(
      'href',
      '/people/d1',
    )
    expect(card).toHaveTextContent('52 years old · Met 2016')
    expect(card).toHaveTextContent('Active')
    expect(card).toHaveTextContent('Last contact: 1 week ago')
    expect(
      within(card).getByRole('img', { name: /3 of 4: Baptised, Serving, Leading/ }),
    ).toBeInTheDocument()
    expect(
      within(card).getByRole('img', { name: 'Shepherded by you and one other' }),
    ).toBeInTheDocument()
    expect(card).toHaveTextContent('1 praying')
  })

  it('renders someone just met: no milestones, contact, shepherds or prayer burdens', () => {
    render(<PersonCard name="Tom Becker" status="new" milestones={[]} prayerCount={0} />)
    const card = screen.getByRole('article')
    expect(within(card).getByRole('heading', { name: 'Tom Becker' })).toBeInTheDocument()
    expect(card).toHaveTextContent('No contact yet')
    expect(card).not.toHaveTextContent('Last contact:')
    expect(card).toHaveTextContent('No milestones yet')
    expect(card).toHaveTextContent('0 praying')
    expect(within(card).queryByRole('img', { name: /Shepherded/ })).not.toBeInTheDocument()
  })

  it('shows the tag beside the status pill', () => {
    render(
      <PersonCard
        name="Elena Petrova"
        status="active"
        tag={<span>14 days overdue</span>}
        milestones={[]}
        prayerCount={0}
      />,
    )
    const tag = screen.getByText('14 days overdue')
    expect(tag.parentElement).toContainElement(screen.getByText('Active'))
  })

  it('reads the prayer count bare, with " praying" for screen readers only', () => {
    render(<PersonCard name="Ann Lee" status="active" milestones={[]} prayerCount={3} />)
    const hidden = screen.getByText('praying')
    expect(hidden).toHaveClass(shared.srOnly)
    expect(hidden.parentElement).toHaveTextContent('3 praying')
  })

  it('shows the shepherds with the name', () => {
    render(
      <PersonCard
        name="Ann Lee"
        status="active"
        milestones={[]}
        prayerCount={0}
        shepherds={{ names: ['Grace Lin'], label: 'Shepherded by Grace Lin' }}
      />,
    )
    expect(screen.getByRole('img', { name: 'Shepherded by Grace Lin' })).toBeInTheDocument()
  })
})

describe('PersonCard compact', () => {
  it('shows only the avatar, name, status, tag and compact milestone bar', () => {
    render(
      <PersonCard
        compact
        name="David Mensah"
        subtitle="52 years old · Met 2016"
        status="active"
        tag={<span>On track</span>}
        lastContact="1 week ago"
        milestones={['Baptised', 'Serving']}
        shepherds={{ names: ['Grace Lin'], label: 'Shepherded by Grace Lin' }}
        prayerCount={2}
      />,
    )
    const card = screen.getByRole('article')
    expect(card).toHaveClass(styles.compact)
    expect(within(card).getByRole('heading', { name: 'David Mensah' })).toBeInTheDocument()
    expect(card).toHaveTextContent('Active')
    expect(card).toHaveTextContent('On track')
    const bar = within(card).getByRole('img', { name: /2 of 4/ })
    expect(bar.parentElement).toHaveClass(progress.compact)
    expect(bar.parentElement).toHaveClass(styles.compactBar)
    expect(card).not.toHaveTextContent('52 years old')
    expect(card).not.toHaveTextContent('Last contact')
    expect(card).not.toHaveTextContent('praying')
    expect(card).not.toHaveTextContent('Baptised')
    expect(within(card).queryByRole('img', { name: /Shepherded/ })).not.toBeInTheDocument()
  })

  it('is not compact by default', () => {
    render(<PersonCard name="Ann Lee" status="active" milestones={[]} prayerCount={0} />)
    expect(screen.getByRole('article')).not.toHaveClass(styles.compact)
  })

  it('renders someone with no milestones (rule 2)', () => {
    render(<PersonCard compact name="Tom Becker" status="new" milestones={[]} prayerCount={0} />)
    expect(screen.getByRole('img', { name: /No milestones yet/ })).toBeInTheDocument()
  })
})

describe('CareCard', () => {
  it('shows an overdue person with meter, tag, note and actions', () => {
    render(
      <CareCard
        name="Elena Petrova"
        status="active"
        urgency="overdue"
        dueLabel="14 days overdue"
        meter={{
          value: 21,
          max: 7,
          label: '21 days since last contact',
          goal: 'Goal: every 7 days',
        }}
        note={{ label: 'Last note, 3 weeks ago', content: 'Text her.' }}
        actions={<Button variant="danger">Contacted today</Button>}
        aside="Shared with Grace Lin"
      />,
    )
    const card = screen.getByRole('article')
    expect(card).toHaveClass(styles.overdue)
    expect(card).toHaveTextContent('14 days overdue')
    const meter = within(card).getByRole('img', {
      name: '21 days since last contact. Goal: every 7 days',
    })
    expect(meter.parentElement).toHaveClass(progress.danger)
    expect(card).toHaveTextContent('Text her.')
    expect(within(card).getByRole('button', { name: 'Contacted today' })).toBeInTheDocument()
    expect(card).toHaveTextContent('Shared with Grace Lin')
  })

  it('uses the warn border and meter when coming up, and needs no note or actions', () => {
    render(
      <CareCard
        name="Aisha Bello"
        status="new"
        urgency="soon"
        dueLabel="24 hours left"
        meter={{ value: 48, max: 72, label: 'Contacted 48 hours ago' }}
      />,
    )
    const card = screen.getByRole('article')
    expect(card).toHaveClass(styles.soon)
    expect(within(card).getByRole('img').parentElement).toHaveClass(progress.warn)
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps the default border when on track', () => {
    render(
      <CareCard
        name="Maria Santos"
        status="active"
        urgency="ok"
        dueLabel="On track"
        meter={{ value: 3, max: 7, label: '3 days since last contact' }}
      />,
    )
    const card = screen.getByRole('article')
    expect(card).not.toHaveClass(styles.overdue)
    expect(card).not.toHaveClass(styles.soon)
  })
})

describe('MiniPersonCard', () => {
  it('shows contact time, prayer count and a compact bar', () => {
    render(
      <MiniPersonCard
        name="Maria Santos"
        lastContact="3 days ago"
        prayerCount={1}
        milestones={['Baptised', 'Small group', 'Serving']}
      />,
    )
    const card = screen.getByRole('article')
    expect(card).toHaveClass(styles.mini)
    expect(screen.getByText('3 days ago')).not.toHaveClass(styles.overdueText)
    expect(card).toHaveTextContent('1 praying')
    expect(within(card).getByRole('img', { name: /3 of 4/ }).parentElement).toHaveClass(
      progress.compact,
    )
  })

  it('marks overdue contact with colour, an icon and words (WCAG 1.4.1)', () => {
    render(
      <MiniPersonCard
        name="Elena Petrova"
        lastContact="3 weeks ago"
        overdue
        prayerCount={0}
        milestones={[]}
      />,
    )
    const line = screen.getByText('Overdue:').parentElement!
    expect(line).toHaveClass(styles.overdueText)
    expect(line).toHaveTextContent('Overdue: 3 weeks ago')
    expect(line.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('has no overdue words when on time', () => {
    render(
      <MiniPersonCard
        name="Maria Santos"
        lastContact="3 days ago"
        prayerCount={0}
        milestones={[]}
      />,
    )
    expect(screen.queryByText('Overdue:')).not.toBeInTheDocument()
  })
})

describe('MiniPersonCard on the board', () => {
  it('shows the contact tag and actions together in the footer', () => {
    render(
      <MiniPersonCard
        name="Maria Santos"
        prayerCount={0}
        milestones={[]}
        tag={<span>On track</span>}
        actions={
          <select aria-label="Move Maria Santos to another status">
            <option>Move to</option>
          </select>
        }
      />,
    )
    const card = screen.getByRole('article')
    const foot = screen.getByText('On track').parentElement!
    expect(foot).toHaveClass(styles.miniFoot)
    expect(within(foot).getByRole('combobox')).toBeInTheDocument()
    expect(card).toContainElement(foot)
  })

  it('has no footer without a tag or actions', () => {
    const { container } = render(<MiniPersonCard name="Ann Lee" prayerCount={0} milestones={[]} />)
    expect(container.querySelector(`.${styles.miniFoot}`)).not.toBeInTheDocument()
  })

  it('shows grip dots only when asked, hidden from assistive tech', () => {
    const { rerender } = render(<MiniPersonCard name="Ann Lee" prayerCount={0} milestones={[]} />)
    expect(screen.getByRole('article').querySelector(`.${styles.grip}`)).not.toBeInTheDocument()
    rerender(<MiniPersonCard name="Ann Lee" prayerCount={0} milestones={[]} grip />)
    expect(screen.getByRole('article').querySelector(`.${styles.grip}`)).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('passes drag props to the article', () => {
    const onDragStart = vi.fn()
    render(
      <MiniPersonCard
        name="Ann Lee"
        prayerCount={0}
        milestones={[]}
        draggable
        onDragStart={onDragStart}
      />,
    )
    const card = screen.getByRole('article')
    expect(card).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(card)
    expect(onDragStart).toHaveBeenCalledTimes(1)
  })

  it('is not draggable by default', () => {
    render(<MiniPersonCard name="Ann Lee" prayerCount={0} milestones={[]} />)
    expect(screen.getByRole('article')).not.toHaveAttribute('draggable')
  })
})

describe('heading levels', () => {
  it('defaults card names to h3', () => {
    render(<PersonCard name="Ann Lee" status="active" milestones={[]} prayerCount={0} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Ann Lee' })).toBeInTheDocument()
  })

  it('lets the page set the level so the outline stays in order', () => {
    render(
      <>
        <PersonCard
          name="Ann Lee"
          status="active"
          milestones={[]}
          prayerCount={0}
          headingLevel={2}
        />
        <CareCard
          name="Bo Kim"
          status="active"
          urgency="ok"
          dueLabel="On track"
          meter={{ value: 1, max: 7, label: '1 day' }}
          headingLevel={4}
        />
        <MiniPersonCard name="Cy Ng" prayerCount={0} milestones={[]} headingLevel={5} />
      </>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Ann Lee' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Bo Kim' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 5, name: 'Cy Ng' })).toBeInTheDocument()
  })
})

describe('AddPersonTile', () => {
  it('is a link that says Add someone new', () => {
    render(<AddPersonTile href="/people/new" />)
    expect(screen.getByRole('link', { name: 'Add someone new' })).toHaveAttribute(
      'href',
      '/people/new',
    )
  })

  it('can be a button', () => {
    render(
      <AddPersonTile as="button" type="button">
        Add person
      </AddPersonTile>,
    )
    expect(screen.getByRole('button', { name: 'Add person' })).toHaveClass(styles.add)
  })
})
