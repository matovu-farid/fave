import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyLocation, parseLocationInput } from '../fave-worker/src/google-maps.ts'

const apiKey = 'test-google-maps-key'

function component(longText, shortText, ...types) {
  return { longText, shortText, types }
}

function addressComponents(area, country = 'Uganda', countryCode = 'UG') {
  return [
    component(area, area, 'administrative_area_level_2'),
    component(country, countryCode, 'country'),
  ]
}

function geocodeResponse(components, overrides = {}) {
  return {
    results: [{
      addressComponents: components,
      formattedAddress: 'Private address, Uganda',
      location: { latitude: 0.35, longitude: 32.58 },
      ...overrides,
    }],
  }
}

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = handler
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('accepts private addresses when Google resolves each supported Uganda pickup area', async () => {
  for (const area of ['Kampala', 'Wakiso', 'Mukono']) {
    await withFetch(async () => new Response(JSON.stringify(geocodeResponse(addressComponents(area))), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }), async () => {
      const result = await classifyLocation({ GOOGLE_MAPS_API_KEY: apiKey }, {
        address: 'Private home address, not a fixed pickup point',
      })

      assert.equal(result.kind, 'resolved')
      assert.equal(result.countryCode, 'UG')
      assert.equal(result.pickupArea, area)
      assert.equal(result.formattedAddress, 'Private address, Uganda')
    })
  }
})

test('geocodes map pins and sends only the required fields to Google', async () => {
  let requestUrl
  let requestHeaders
  await withFetch(async (url, options) => {
    requestUrl = new URL(url)
    requestHeaders = new Headers(options.headers)
    return new Response(JSON.stringify(geocodeResponse(addressComponents('Wakiso'))), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }, async () => {
    const result = await classifyLocation({ GOOGLE_MAPS_APIKEY: apiKey }, {
      latitude: 0.35,
      longitude: 32.58,
    })

    assert.equal(result.kind, 'resolved')
    assert.equal(requestUrl.pathname, '/v4/geocode/location')
    assert.equal(requestUrl.searchParams.get('location.latitude'), '0.35')
    assert.equal(requestUrl.searchParams.get('location.longitude'), '32.58')
    assert.equal(requestUrl.searchParams.get('regionCode'), 'UG')
    assert.equal(requestHeaders.get('X-Goog-Api-Key'), apiKey)
    assert.equal(requestHeaders.get('X-Goog-FieldMask'), 'results.addressComponents,results.formattedAddress,results.location')
  })
})

test('accepts private addresses and map pins while rejecting malformed locations', () => {
  assert.deepEqual(parseLocationInput({ address: '  Private driveway  ' }), { address: 'Private driveway' })
  assert.deepEqual(parseLocationInput({ latitude: 0.35, longitude: 32.58 }), { latitude: 0.35, longitude: 32.58 })
  assert.equal(parseLocationInput({ address: '   ' }), null)
  assert.equal(parseLocationInput({ latitude: 91, longitude: 32.58 }), null)
  assert.equal(parseLocationInput({ latitude: 0.35, longitude: Number.NaN }), null)
  assert.equal(parseLocationInput({ address: '' }), null)
})

test('classifies unapproved Uganda districts and foreign countries distinctly', async () => {
  await withFetch(async () => new Response(JSON.stringify(geocodeResponse(addressComponents('Gulu'))), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), async () => {
    const result = await classifyLocation({ GOOGLE_MAPS_API_KEY: apiKey }, { address: 'Private address' })
    assert.equal(result.kind, 'resolved')
    assert.equal(result.countryCode, 'UG')
    assert.equal(result.pickupArea, null)
  })

  await withFetch(async () => new Response(JSON.stringify(geocodeResponse(addressComponents('Kampala', 'Kenya', 'KE'))), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), async () => {
    const result = await classifyLocation({ GOOGLE_MAPS_API_KEY: apiKey }, { address: 'Private address' })
    assert.equal(result.kind, 'resolved')
    assert.equal(result.countryCode, 'KE')
  })
})

test('treats conflicting or incomplete Google candidates as unresolved', async () => {
  const candidates = [
    {
      addressComponents: addressComponents('Kampala'),
      formattedAddress: 'Kampala, Uganda',
      location: { latitude: 0.35, longitude: 32.58 },
    },
    {
      addressComponents: addressComponents('Mukono'),
      formattedAddress: 'Mukono, Uganda',
      location: { latitude: 0.35, longitude: 32.58 },
    },
  ]

  await withFetch(async () => new Response(JSON.stringify({ results: candidates }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), async () => {
    const result = await classifyLocation({ GOOGLE_MAPS_API_KEY: apiKey }, { address: 'Ambiguous address' })
    assert.deepEqual(result, { kind: 'unresolved' })
  })
})

test('returns provider_error when Google is unavailable or no API key is configured', async () => {
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    return new Response('unavailable', { status: 503 })
  }
  try {
    assert.deepEqual(await classifyLocation({ GOOGLE_MAPS_API_KEY: apiKey }, { address: 'Private address' }), { kind: 'provider_error' })
    assert.deepEqual(await classifyLocation({}, { address: 'Private address' }), { kind: 'provider_error' })
    assert.equal(requestCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
