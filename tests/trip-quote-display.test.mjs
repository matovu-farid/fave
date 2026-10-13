import test from 'node:test'
import assert from 'node:assert/strict'

import { getDriverAccommodationNotice } from '../src/lib/trip-quote-display.ts'

test('explains the driver allowance without implying client lodging is arranged', () => {
  const notice = getDriverAccommodationNotice([
    { label: 'Distance', unit: 'per_kilometer' },
    { label: 'Driver accommodation', unit: 'per_night' },
  ])

  assert.equal(notice, 'The nightly accommodation allowance is paid to your driver for lodging of any kind. Fave does not arrange or pay for your accommodation.')
})

test('does not show the lodging notice for unrelated per-night quote items', () => {
  assert.equal(getDriverAccommodationNotice([{ label: 'Vehicle', unit: 'per_night' }]), null)
})
