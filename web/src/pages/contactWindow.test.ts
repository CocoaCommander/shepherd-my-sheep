import { describe, expect, it } from 'vitest'
import { contactWindow } from './contactWindow'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// A Wednesday morning, local time.
const NOW = new Date(2026, 9, 14, 9, 41, 7)
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

function win(overrides: Record<string, unknown> = {}) {
  return contactWindow(
    {
      status: { name: 'active' },
      lastContactedAt: at(-2 * DAY),
      contactClockStart: at(-2 * DAY),
      contactDueAt: at(5 * DAY),
      createdAt: at(-60 * DAY),
      ...overrides,
    } as Parameters<typeof contactWindow>[0],
    NOW,
  )
}

describe('contactWindow', () => {
  it('is null when the person is not tracked', () => {
    expect(win({ contactClockStart: null, contactDueAt: null })).toBeNull()
    expect(win({ contactClockStart: null })).toBeNull()
    expect(win({ contactDueAt: null })).toBeNull()
  })

  it('spans from the last contact to the due time', () => {
    expect(win()).toMatchObject({ value: 2 * DAY, max: 7 * DAY, kind: 'contact', span: '2 days' })
  })

  it('counts from when a new contact was added when nothing is logged', () => {
    expect(
      win({
        status: { name: 'new contact' },
        lastContactedAt: null,
        createdAt: at(-20 * HOUR),
        contactClockStart: at(-20 * HOUR),
        contactDueAt: at(52 * HOUR),
      }),
    ).toMatchObject({ value: 20 * HOUR, max: 72 * HOUR, kind: 'added', span: '20 hours' })
  })

  it('is an active person with no contact ever, counted from when they were added', () => {
    expect(
      win({ lastContactedAt: null, createdAt: at(-3 * DAY), contactClockStart: at(-3 * DAY) }),
    ).toMatchObject({ kind: 'added', span: '3 days' })
  })

  it('is moved when the clock restarted after the last contact', () => {
    expect(win({ lastContactedAt: at(-10 * DAY), contactClockStart: at(-2 * DAY) })).toMatchObject({
      kind: 'moved',
      span: '2 days',
      value: 2 * DAY,
      max: 7 * DAY,
    })
  })

  it('is moved when the clock restarted after createdAt with no contact', () => {
    expect(
      win({
        status: { name: 'new contact' },
        lastContactedAt: null,
        createdAt: at(-10 * DAY),
        contactClockStart: at(-5 * HOUR),
        contactDueAt: at(67 * HOUR),
      }),
    ).toMatchObject({ kind: 'moved', span: '5 hours', value: 5 * HOUR, max: 72 * HOUR })
  })

  it('words spans the way the page does', () => {
    const span = (ms: number) => win({ lastContactedAt: at(-ms), contactClockStart: at(-ms) })?.span
    expect(span(20 * 60_000)).toBe('under an hour')
    expect(span(HOUR)).toBe('1 hour')
    expect(span(5 * HOUR)).toBe('5 hours')
    expect(span(DAY)).toBe('1 day')
    expect(span(3 * DAY)).toBe('3 days')
  })
})
