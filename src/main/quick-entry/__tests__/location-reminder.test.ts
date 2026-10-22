import { describe, expect, it } from 'vitest'
import { quickEntryLocationReminder } from '../location-reminder'

describe('the location reminder of a Quick Entry create', () => {
  it('is written on the server id with the default radius', () => {
    expect(quickEntryLocationReminder(42, { place: 'home', trigger: 'leave' })).toEqual({
      key: 'location_reminder.42',
      value: { place: 'home', trigger: 'leave', radius_m: 200 },
    })
  })

  it('is not written for a create without a server id', () => {
    expect(quickEntryLocationReminder(undefined, { place: 'home', trigger: 'arrive' })).toBeNull()
    expect(quickEntryLocationReminder(-3, { place: 'home', trigger: 'arrive' })).toBeNull()
  })

  it('is not written when the window asked for none or sent something else', () => {
    expect(quickEntryLocationReminder(42, undefined)).toBeNull()
    expect(quickEntryLocationReminder(42, { place: 'a.b', trigger: 'arrive' })).toBeNull()
    expect(quickEntryLocationReminder(42, { place: 'home', trigger: 'nearby' })).toBeNull()
    expect(quickEntryLocationReminder(42, ['home', 'arrive'])).toBeNull()
  })
})
