import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const tripScreen = fileURLToPath(new URL('../src/app/(tabs)/trips/index.tsx', import.meta.url))
const driverScreen = fileURLToPath(new URL('../src/app/(tabs)/driver/index.tsx', import.meta.url))

test('client quote renders directional vehicle costs using server route snapshots', () => {
  const source = readFileSync(tripScreen, 'utf8')
  assert.match(source, /quote\.quote\.outboundRoute/u)
  assert.match(source, /quote\.quote\.returnRoute/u)
  assert.match(source, /component\.key === 'outbound_transport'/u)
  assert.match(source, /component\.key === 'return_transport'/u)
  assert.match(source, /component\.unitRate\.toLocaleString\(\)/u)
  assert.match(source, /\{quote\.quote\.currency\}\/km/u)
  assert.match(source, /getDriverAccommodationNotice\(quote\.quote\.components\)/u)
  assert.match(source, /!quote\.quote\.outboundRoute \|\| !quote\.quote\.returnRoute/u)
  assert.doesNotMatch(source, /Route · \{\(quote\.route\.distanceMeters/u)
})

test('driver vehicle registration asks one round-trip amount per car and blocks missing route basis', () => {
  const source = readFileSync(driverScreen, 'utf8')
  assert.match(source, /Round-trip amount \(UGX\)/u)
  assert.match(source, /requirements\.benchmarkBasis\.roundTripDistanceMeters/u)
  assert.match(source, /!requirements\.benchmarkBasis/u)
  assert.match(source, /operating costs and vehicle type/u)
})
