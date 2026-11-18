import { describe, expect, it } from 'vitest'
import { descriptionError, nameError, people, recordedText } from './milestoneRules'

const list = [
  { id: 'a', name: 'Baptised' },
  { id: 'b', name: 'serving' },
]

describe('nameError', () => {
  it('asks for a name when blank or only spaces', () => {
    expect(nameError('', list)).toBe('Enter a name for the milestone.')
    expect(nameError('   ', list)).toBe('Enter a name for the milestone.')
  })

  it('accepts a new name, with or without an empty list (rule 7)', () => {
    expect(nameError('Mentoring', list)).toBeUndefined()
    expect(nameError('Mentoring', [])).toBeUndefined()
  })

  it('counts code points after trimming: 100 multi-byte characters pass, 101 fail', () => {
    expect(nameError('😀'.repeat(100), [])).toBeUndefined()
    expect(nameError(`  ${'😀'.repeat(100)}  `, [])).toBeUndefined()
    expect(nameError('😀'.repeat(101), [])).toBe('Use 100 characters or fewer.')
    expect(nameError('a'.repeat(101), [])).toBe('Use 100 characters or fewer.')
  })

  it('rejects a duplicate ignoring case and surrounding spaces, naming the listed spelling', () => {
    expect(nameError('baptised', list)).toBe('A milestone called “Baptised” already exists.')
    expect(nameError('  SERVING ', list)).toBe('A milestone called “serving” already exists.')
  })

  it('lets a milestone keep or recase its own name but not take another’s', () => {
    expect(nameError('baptised', list, 'a')).toBeUndefined()
    expect(nameError('Baptised', list, 'a')).toBeUndefined()
    expect(nameError('Serving', list, 'a')).toBe('A milestone called “serving” already exists.')
  })
})

describe('descriptionError', () => {
  it('allows empty and up to 1000 characters after trimming', () => {
    expect(descriptionError('')).toBeUndefined()
    expect(descriptionError('a'.repeat(1000))).toBeUndefined()
    expect(descriptionError(`  ${'😀'.repeat(1000)}  `)).toBeUndefined()
  })

  it('rejects 1001 characters', () => {
    expect(descriptionError('a'.repeat(1001))).toBe(
      'Use 1000 characters or fewer for the description.',
    )
    expect(descriptionError('😀'.repeat(1001))).toBe(
      'Use 1000 characters or fewer for the description.',
    )
  })
})

describe('recordedText and people', () => {
  it('words zero, one and many', () => {
    expect(recordedText(0)).toBe('Not recorded yet')
    expect(recordedText(1)).toBe('Recorded for 1 person')
    expect(recordedText(6)).toBe('Recorded for 6 people')
    expect(people(1)).toBe('1 person')
    expect(people(2)).toBe('2 people')
  })
})
