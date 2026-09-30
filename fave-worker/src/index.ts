import { Hono } from 'hono'
import { createAuth, type AuthBindings } from './auth'
import {
  classifyLocation,
  computeDrivingRoute,
  parseLocationInput,
} from './google-maps'

const app = new Hono<{ Bindings: AuthBindings }>()

app.all('/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ status: 'ok', database: 'ok' })
  } catch {
    return c.json({ status: 'error', database: 'unavailable' }, 503)
  }
})

app.get('/api/me', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  return c.json({ user: session.user })
})

app.post('/api/maps/pickup-eligibility', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      401,
    )
  }

  const body: unknown = await c.req.json().catch(() => null)
  const location = parseLocationInput(body)
  if (!location) {
    return c.json(
      {
        error: {
          code: 'INVALID_LOCATION',
          message: 'Enter a pickup address or choose a valid map location.',
        },
      },
      400,
    )
  }

  const result = await classifyLocation(c.env, location)
  if (result.kind === 'provider_error') {
    return c.json(
      {
        error: {
          code: c.env.GOOGLE_MAPS_API_KEY
            ? 'GOOGLE_MAPS_UNAVAILABLE'
            : 'GOOGLE_MAPS_NOT_CONFIGURED',
          message: 'Pickup location checks are temporarily unavailable.',
        },
      },
      503,
    )
  }

  if (result.kind === 'unresolved' || !result.countryCode) {
    return c.json({
      eligible: false,
      reason: 'location_unverified',
      message: 'We could not verify this pickup. Adjust the address or map pin.',
    })
  }

  if (result.countryCode !== 'UG' || !result.pickupArea) {
    return c.json({
      eligible: false,
      reason: 'outside_service_area',
      message:
        'Pickups must be in Kampala, Mukono, or Wakiso. Choose another address or map pin.',
    })
  }

  return c.json({ eligible: true, area: result.pickupArea })
})

app.post('/api/maps/driving-route', async (c) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  })

  if (!session) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      401,
    )
  }

  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json(
      {
        error: {
          code: 'INVALID_ROUTE',
          message: 'Provide a pickup and destination address or map location.',
        },
      },
      400,
    )
  }

  const routeBody = body as Record<string, unknown>
  const origin = parseLocationInput(routeBody.origin)
  const destination = parseLocationInput(routeBody.destination)
  if (!origin || !destination) {
    return c.json(
      {
        error: {
          code: 'INVALID_ROUTE',
          message: 'Provide a pickup and destination address or map location.',
        },
      },
      400,
    )
  }

  const pickup = await classifyLocation(c.env, origin)
  if (pickup.kind === 'provider_error') {
    return c.json(
      {
        error: {
          code: c.env.GOOGLE_MAPS_API_KEY
            ? 'GOOGLE_MAPS_UNAVAILABLE'
            : 'GOOGLE_MAPS_NOT_CONFIGURED',
          message: 'We could not check this pickup or route right now.',
        },
      },
      503,
    )
  }

  if (
    pickup.kind !== 'resolved' ||
    pickup.countryCode !== 'UG' ||
    !pickup.pickupArea
  ) {
    return c.json(
      {
        error: {
          code: 'PICKUP_OUTSIDE_SERVICE_AREA',
          message:
            'Pickups must be in Kampala, Mukono, or Wakiso. Adjust the address or map pin.',
        },
      },
      422,
    )
  }

  const destinationLocation = await classifyLocation(c.env, destination)
  if (destinationLocation.kind === 'provider_error') {
    return c.json(
      {
        error: {
          code: 'GOOGLE_MAPS_UNAVAILABLE',
          message: 'We could not check this destination or route right now.',
        },
      },
      503,
    )
  }

  if (
    destinationLocation.kind !== 'resolved' ||
    destinationLocation.countryCode !== 'UG'
  ) {
    return c.json(
      {
        error: {
          code: 'DESTINATION_OUTSIDE_UGANDA',
          message: 'Destinations must be in Uganda. Adjust the address or map pin.',
        },
      },
      422,
    )
  }

  const route = await computeDrivingRoute(c.env, origin, destination)
  if (route.kind === 'provider_error') {
    return c.json(
      {
        error: {
          code: c.env.GOOGLE_MAPS_API_KEY
            ? 'GOOGLE_MAPS_UNAVAILABLE'
            : 'GOOGLE_MAPS_NOT_CONFIGURED',
          message: 'We could not calculate this road route right now.',
        },
      },
      503,
    )
  }

  if (route.kind === 'no_route') {
    return c.json(
      {
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Google Maps could not find a drivable route for these locations.',
        },
      },
      422,
    )
  }

  return c.json({
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    provider: 'google_maps',
  })
})

export default app
