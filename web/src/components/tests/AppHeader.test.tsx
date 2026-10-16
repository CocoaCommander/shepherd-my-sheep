import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, NavLink } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader, Bell, Brand } from '../AppHeader/AppHeader'
import styles from '../AppHeader/AppHeader.module.css'
import { Button } from '../Button/Button'

describe('AppHeader', () => {
  it('shows the brand, navigation with the current page, and account actions', () => {
    render(
      <MemoryRouter initialEntries={['/prayer']}>
        <AppHeader
          brand={<Brand as={Link} to="/" />}
          nav={
            <>
              <NavLink to="/" end>
                My people
              </NavLink>
              <NavLink to="/prayer">Prayer list</NavLink>
            </>
          }
          actions={
            <>
              <Bell count={4} label="4 people need contacting" />
              <span>Daniel Okafor</span>
              <Button variant="text">Sign out</Button>
            </>
          }
        />
      </MemoryRouter>,
    )
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Shepherd My Sheep' })).toHaveAttribute(
      'href',
      '/',
    )
    const nav = within(header).getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Prayer list' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'My people' })).not.toHaveAttribute('aria-current')
    expect(header).toHaveTextContent('Daniel Okafor')
    expect(within(header).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('shows only the brand and one action in a focused flow', () => {
    render(<AppHeader actions={<Button variant="secondary">Exit review</Button>} />)
    const header = screen.getByRole('banner')
    expect(header).toHaveTextContent('Shepherd My Sheep')
    expect(within(header).queryByRole('navigation')).not.toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Exit review' })).toBeInTheDocument()
    expect(within(header).queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('folds the nav and actions behind a Menu button for phones, keeping alerts out', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AppHeader
          nav={<Link to="/prayer">Prayer list</Link>}
          alerts={<Bell count={2} label="2 people need contacting" />}
          actions={<Button variant="text">Sign out</Button>}
        />
      </MemoryRouter>,
    )
    // CSS hides it at desktop width, and jsdom doesn't apply the phone media query, so it
    // has no computed accessible name here; find it by its label instead.
    const menu = screen.getByLabelText('Menu')
    expect(menu.tagName).toBe('BUTTON')
    const panel = document.getElementById(menu.getAttribute('aria-controls')!)!
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toContainElement(screen.getByRole('navigation', { name: 'Main' }))
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Sign out' }))
    expect(panel).not.toContainElement(
      screen.getByRole('button', { name: '2 people need contacting' }),
    )

    await user.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(menu).toHaveAttribute('aria-expanded', 'false')

    await user.click(menu)
    await user.click(screen.getByRole('link', { name: 'Prayer list' }))
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Bell', () => {
  it('is a labelled button with a badge', async () => {
    const onClick = vi.fn()
    render(<Bell count={4} label="4 people need contacting" onClick={onClick} />)
    const bell = screen.getByRole('button', { name: '4 people need contacting' })
    expect(bell).toHaveAttribute('type', 'button')
    expect(bell.querySelector(`.${styles.bellCount}`)).toHaveTextContent('4')
    await userEvent.click(bell)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('hides the badge when no one needs contacting', () => {
    render(<Bell count={0} label="No one needs contacting" />)
    const bell = screen.getByRole('button', { name: 'No one needs contacting' })
    expect(bell.querySelector(`.${styles.bellCount}`)).not.toBeInTheDocument()
  })

  it('can be a router link', () => {
    render(
      <MemoryRouter>
        <Bell as={Link} to="/" count={2} label="2 people need contacting" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: '2 people need contacting' })
    expect(link).toHaveAttribute('href', '/')
    expect(link).not.toHaveAttribute('type')
  })
})
