import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar, AvatarStack, avatarTint, initials } from '../Avatar/Avatar'
import styles from '../Avatar/Avatar.module.css'

describe('initials', () => {
  it.each([
    ['Maria Santos', 'MS'],
    ['maria del santos', 'MS'],
    ['Cher', 'C'],
    ['  Elena   Petrova  ', 'EP'],
    ['', ''],
  ])('%j → %j', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})

describe('avatarTint', () => {
  it('rotates the five tints by position', () => {
    expect([0, 1, 2, 3, 4, 5].map(avatarTint)).toEqual([
      'green',
      'blue',
      'sand',
      'rose',
      'violet',
      'green',
    ])
  })
})

describe('Avatar', () => {
  it('shows initials and is hidden from assistive tech', () => {
    render(<Avatar name="David Mensah" />)
    const avatar = screen.getByText('DM')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).toHaveClass(styles.avatar)
  })

  it('applies size and tint', () => {
    render(<Avatar name="Priya Nair" size="xl" tint="sand" />)
    expect(screen.getByText('PN')).toHaveClass(styles.xl, styles.sand)
  })

  it('uses the default green tint without a tint class', () => {
    render(<Avatar name="Ann Lee" />)
    const avatar = screen.getByText('AL')
    for (const tint of ['blue', 'sand', 'rose', 'violet']) {
      expect(avatar).not.toHaveClass(styles[tint])
    }
  })
})

describe('AvatarStack', () => {
  it('is one labelled image of every shepherd', () => {
    render(
      <AvatarStack
        names={['Daniel Okafor', 'Grace Lin']}
        label="Shepherded by you and one other"
      />,
    )
    const stack = screen.getByRole('img', { name: 'Shepherded by you and one other' })
    expect(stack).toHaveTextContent('DOGL')
    expect(stack.children).toHaveLength(2)
  })
})
