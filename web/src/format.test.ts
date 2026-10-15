import { describe, expect, it } from 'vitest'
import { contactStateLabel, isToday } from './format'

describe('contactStateLabel', () => {
  const now = new Date('2026-10-14T12:00:00Z')

  it('says how long ago an overdue contact was due', () => {
    expect(contactStateLabel('OVERDUE', '2026-10-12 12:00:00+00', now)).toBe('Overdue · 2 days')
    expect(contactStateLabel('OVERDUE', '2026-10-13 11:00:00+00', now)).toBe('Overdue · 1 day')
    expect(contactStateLabel('OVERDUE', '2026-10-14 07:00:00+00', now)).toBe('Overdue · 5 hours')
    expect(contactStateLabel('OVERDUE', '2026-10-14 11:30:00+00', now)).toBe(
      'Overdue · under an hour',
    )
  })

  it('says how long is left when due soon', () => {
    expect(contactStateLabel('DUE_SOON', '2026-10-15 13:00:00+00', now)).toBe('Due in 1 day')
    expect(contactStateLabel('DUE_SOON', '2026-10-14 13:00:00+00', now)).toBe('Due in 1 hour')
  })

  it('is "On track" when on track, and nothing when not tracked', () => {
    expect(contactStateLabel('ON_TRACK', '2026-10-20 12:00:00+00', now)).toBe('On track')
    expect(contactStateLabel('NOT_TRACKED', null, now)).toBeNull()
  })
})

describe('isToday', () => {
  it('compares in the local time zone', () => {
    const now = new Date(2026, 9, 14, 12, 0, 0)
    expect(isToday(new Date(2026, 9, 14, 0, 5).toISOString(), now)).toBe(true)
    expect(isToday(new Date(2026, 9, 13, 23, 55).toISOString(), now)).toBe(false)
  })
})
