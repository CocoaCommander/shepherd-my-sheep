import { describe, expect, it } from 'vitest'
import {
  contactDateToTimestamp,
  dateAgo,
  contactDueLabel,
  contactStateLabel,
  firstName,
  formatShortDate,
  isToday,
  timeAgo,
} from './format'

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

describe('contactDueLabel', () => {
  // A Wednesday morning, local time.
  const now = new Date(2026, 9, 14, 9, 0)
  const hours = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString()
  const day = (offset: number, hour = 9) => new Date(2026, 9, 14 + offset, hour).toISOString()
  const active = (contactState: string, contactDueAt: string | null) =>
    contactDueLabel({ status: { name: 'active' }, contactState, contactDueAt }, now)
  const newContact = (contactState: string, contactDueAt: string) =>
    contactDueLabel({ status: { name: 'new contact' }, contactState, contactDueAt }, now)

  it('counts calendar days overdue for an active person', () => {
    expect(active('OVERDUE', day(-3))).toEqual({ tone: 'overdue', title: '3 days overdue' })
    expect(active('OVERDUE', day(-1, 23))).toEqual({ tone: 'overdue', title: '1 day overdue' })
    expect(active('OVERDUE', day(0, 8))).toEqual({ tone: 'overdue', title: 'Overdue today' })
  })

  it('says due today or in n days when due soon', () => {
    expect(active('DUE_SOON', day(0, 22))).toEqual({ tone: 'soon', title: 'Due today' })
    expect(active('DUE_SOON', day(1, 6))).toEqual({ tone: 'soon', title: 'Due in 1 day' })
    expect(active('DUE_SOON', day(2))).toEqual({ tone: 'soon', title: 'Due in 2 days' })
  })

  it('gives the days to the next contact when on track', () => {
    expect(active('ON_TRACK', day(5))).toEqual({
      tone: 'ok',
      title: 'On track',
      detail: 'Next contact due in 5 days',
    })
  })

  it('counts hours, rounded down, for a new contact', () => {
    expect(newContact('OVERDUE', hours(-2))).toEqual({
      tone: 'overdue',
      title: 'Follow-up overdue',
    })
    expect(newContact('DUE_SOON', hours(5.9))).toEqual({ tone: 'soon', title: '5 hours left' })
    expect(newContact('DUE_SOON', hours(1))).toEqual({ tone: 'soon', title: '1 hour left' })
    expect(newContact('DUE_SOON', hours(0.5))).toEqual({
      tone: 'soon',
      title: 'Under an hour left',
    })
    expect(newContact('ON_TRACK', hours(71))).toEqual({
      tone: 'ok',
      title: 'On track',
      detail: '71 hours left to log a contact',
    })
  })

  it('trusts the server state rather than the due time', () => {
    // Overdue per the server even though the device clock says it's in the future.
    expect(active('OVERDUE', day(1))).toEqual({ tone: 'overdue', title: 'Overdue today' })
  })

  it('is null when not tracked', () => {
    expect(active('NOT_TRACKED', null)).toBeNull()
    expect(
      contactDueLabel({ status: { name: 'inactive' }, contactState: 'NOT_TRACKED' }, now),
    ).toBeNull()
  })
})

describe('isToday', () => {
  it('compares in the local time zone', () => {
    const now = new Date(2026, 9, 14, 12, 0, 0)
    expect(isToday(new Date(2026, 9, 14, 0, 5).toISOString(), now)).toBe(true)
    expect(isToday(new Date(2026, 9, 13, 23, 55).toISOString(), now)).toBe(false)
  })
})

describe('contactDateToTimestamp', () => {
  const now = new Date(2026, 9, 14, 9, 41, 7)

  it('sends the current time for today', () => {
    expect(contactDateToTimestamp('2026-10-14', now)).toBe(now.toISOString())
  })

  it('sends noon local time for an earlier day', () => {
    expect(contactDateToTimestamp('2026-10-10', now)).toBe(new Date(2026, 9, 10, 12).toISOString())
    expect(contactDateToTimestamp('2025-12-31', now)).toBe(new Date(2025, 11, 31, 12).toISOString())
  })
})

describe('firstName', () => {
  it('takes the first word of the name', () => {
    expect(firstName('Maria Santos')).toBe('Maria')
    expect(firstName('  Mary Ann  Lee ')).toBe('Mary')
    expect(firstName('Cher')).toBe('Cher')
  })
})

describe('formatShortDate', () => {
  it('shows the weekday, month and day in the local time zone', () => {
    const expected = new Date(2026, 9, 14).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    expect(formatShortDate(new Date(2026, 9, 14, 23, 30).toISOString())).toBe(expected)
  })
})

describe('dateAgo', () => {
  // Late evening local time: a UTC-based count would already be on the next day in some zones.
  const now = new Date(2026, 9, 14, 23, 30)

  it('counts whole local calendar days', () => {
    expect(dateAgo('2026-10-14', now)).toBe('today')
    expect(dateAgo('2026-10-13', now)).toBe('1 day ago')
    expect(dateAgo('2026-10-11', now)).toBe('3 days ago')
  })

  it('is "today" for a future date', () => {
    expect(dateAgo('2026-10-20', now)).toBe('today')
  })

  it('uses the same wording as timeAgo for longer spans', () => {
    expect(dateAgo('2026-10-07', now)).toBe('1 week ago')
    expect(dateAgo('2025-10-14', now)).toBe('1 year ago')
    expect(dateAgo('2021-10-14', now)).toBe('5 years ago')
  })

  it('counts a full week across a daylight-saving change (US 8 Mar, EU 29 Mar)', () => {
    expect(dateAgo('2026-03-02', new Date(2026, 2, 9, 0, 10))).toBe('1 week ago')
    expect(dateAgo('2026-03-23', new Date(2026, 2, 30, 0, 10))).toBe('1 week ago')
    expect(dateAgo('2026-03-07', new Date(2026, 2, 8, 0, 10))).toBe('1 day ago')
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  const ago = (days: number, extraHours = 0) =>
    new Date(now.getTime() - (days * 24 + extraHours) * 3_600_000)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '+00')

  it('is "today" under a day, and for the future', () => {
    expect(timeAgo(ago(0), now)).toBe('today')
    expect(timeAgo(ago(0, 23), now)).toBe('today')
    expect(timeAgo(ago(-3), now)).toBe('today')
  })

  it('counts days up to a week', () => {
    expect(timeAgo(ago(1), now)).toBe('1 day ago')
    expect(timeAgo(ago(1, 23), now)).toBe('1 day ago')
    expect(timeAgo(ago(2), now)).toBe('2 days ago')
    expect(timeAgo(ago(6), now)).toBe('6 days ago')
  })

  it('says "1 week ago" from 7 to 13 days, then rounds weeks', () => {
    expect(timeAgo(ago(7), now)).toBe('1 week ago')
    expect(timeAgo(ago(13), now)).toBe('1 week ago')
    expect(timeAgo(ago(14), now)).toBe('2 weeks ago')
    expect(timeAgo(ago(59), now)).toBe('8 weeks ago')
  })

  it('rounds months from 60 days and years from 365', () => {
    expect(timeAgo(ago(60), now)).toBe('2 months ago')
    expect(timeAgo(ago(364), now)).toBe('12 months ago')
    expect(timeAgo(ago(365), now)).toBe('1 year ago')
    expect(timeAgo(ago(800), now)).toBe('2 years ago')
  })

  it('parses the API DateTime format', () => {
    expect(timeAgo('2026-10-13 11:00:00.5+00', now)).toBe('1 day ago')
  })
})
