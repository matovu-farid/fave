type GoogleMapsBindings = {
  GOOGLE_MAPS_API_KEY?: string
  GOOGLE_MAPS_APIKEY?: string
}

export function getGoogleMapsApiKey(bindings: GoogleMapsBindings): string | undefined {
  return bindings.GOOGLE_MAPS_API_KEY ?? bindings.GOOGLE_MAPS_APIKEY
}

export type SupportedPickupArea = 'Kampala' | 'Mukono' | 'Wakiso'

export type LocationInput =
  | { address: string }
  | { latitude: number; longitude: number }

export type LocationClassification =
  | {
      kind: 'resolved'
      countryCode: string | null
      pickupArea: SupportedPickupArea | null
      formattedAddress: string | null
      latitude: number
      longitude: number
    }
  | { kind: 'unresolved' }
  | { kind: 'provider_error' }

type AddressComponent = {
  longText?: unknown
  shortText?: unknown
  types?: unknown
}

type GeocodeResponse = {
  results?: Array<{
    addressComponents?: AddressComponent[]
    formattedAddress?: unknown
    location?: { latitude?: unknown; longitude?: unknown }
  }>
}

type RouteResponse = {
  routes?: Array<{
    distanceMeters?: unknown
    duration?: unknown
  }>
}

const GEOCODING_URL = 'https://geocode.googleapis.com/v4/geocode/'
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const GEOCODE_FIELD_MASK = 'results.addressComponents,results.formattedAddress,results.location'
const ROUTE_FIELD_MASK = 'routes.distanceMeters,routes.duration'

const AREA_NAMES: Record<string, SupportedPickupArea> = {
  kampala: 'Kampala',
  mukono: 'Mukono',
  wakiso: 'Wakiso',
}

const ADMINISTRATIVE_COMPONENT_TYPES = new Set([
  'locality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'sublocality_level_4',
  'sublocality_level_5',
])

function normalizeAreaName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/\s+(district|city|capital city)$/u, '')
}

function extractCountryCode(components: AddressComponent[]): string | null {
  const country = components.find(
    (component) =>
      Array.isArray(component.types) && component.types.includes('country'),
  )

  if (typeof country?.shortText === 'string') {
    return country.shortText.trim().toUpperCase() || null
  }

  if (typeof country?.longText === 'string') {
    return country.longText.trim().toLocaleLowerCase('en') === 'uganda'
      ? 'UG'
      : country.longText.trim().toUpperCase() || null
  }

  return null
}

function extractPickupArea(
  components: AddressComponent[],
): SupportedPickupArea | null {
  for (const component of components) {
    if (
      !Array.isArray(component.types) ||
      !component.types.some(
        (type) =>
          typeof type === 'string' &&
          ADMINISTRATIVE_COMPONENT_TYPES.has(type),
      )
    ) {
      continue
    }

    for (const name of [component.longText, component.shortText]) {
      if (typeof name !== 'string') continue

      const area = AREA_NAMES[normalizeAreaName(name)]
      if (area) return area
    }
  }

  return null
}

function hasAdministrativeComponent(components: AddressComponent[]): boolean {
  return components.some(
    (component) =>
      Array.isArray(component.types) &&
      component.types.some(
        (type) =>
          typeof type === 'string' &&
          ADMINISTRATIVE_COMPONENT_TYPES.has(type),
      ),
  )
}

function buildGeocodeUrl(input: LocationInput): URL {
  if ('address' in input) {
    const url = new URL(
      `address/${encodeURIComponent(input.address)}`,
      GEOCODING_URL,
    )
    url.searchParams.set('regionCode', 'UG')
    url.searchParams.set('languageCode', 'en')
    return url
  }

  const url = new URL('location', GEOCODING_URL)
  url.searchParams.set('location.latitude', String(input.latitude))
  url.searchParams.set('location.longitude', String(input.longitude))
  url.searchParams.set('regionCode', 'UG')
  url.searchParams.set('languageCode', 'en')
  return url
}

export function parseLocationInput(value: unknown): LocationInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const input = value as Record<string, unknown>
  if (typeof input.address === 'string') {
    const address = input.address.trim()
    return address.length > 0 && address.length <= 250 ? { address } : null
  }

  const { latitude, longitude } = input
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  return { latitude, longitude }
}

export async function classifyLocation(
  bindings: GoogleMapsBindings,
  input: LocationInput,
): Promise<LocationClassification> {
  const apiKey = getGoogleMapsApiKey(bindings)
  if (!apiKey) return { kind: 'provider_error' }

  try {
    const response = await fetch(buildGeocodeUrl(input), {
      headers: {
        Accept: 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GEOCODE_FIELD_MASK,
      },
    })

    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: 'google_maps_geocode_failed',
          httpStatus: response.status,
        }),
      )
      return { kind: 'provider_error' }
    }

    const data = (await response.json()) as GeocodeResponse
    const results = data.results ?? []
    const firstResult = results[0]
    const components = firstResult?.addressComponents
    if (!components || components.length === 0) {
      return { kind: 'unresolved' }
    }

    const candidateComponents = results
      .map((result) => result.addressComponents)
      .filter(
        (candidate): candidate is AddressComponent[] =>
          Array.isArray(candidate) && candidate.length > 0,
      )
      .filter(hasAdministrativeComponent)
    const candidateCountries = new Set(
      candidateComponents.map(extractCountryCode),
    )
    const candidateAreas = new Set(
      candidateComponents.map((candidate) => extractPickupArea(candidate)),
    )

    // Geocoding can return multiple candidates. Missing country or area data
    // counts as ambiguity when another candidate resolves it; do not trust one
    // plausible candidate if Google's alternatives disagree or are incomplete.
    if (candidateCountries.size > 1 || candidateAreas.size > 1) {
      return { kind: 'unresolved' }
    }

    const latitude = 'latitude' in input ? input.latitude : firstResult.location?.latitude
    const longitude = 'longitude' in input ? input.longitude : firstResult.location?.longitude
    if (
      typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      return { kind: 'unresolved' }
    }
    const formattedAddress = typeof firstResult.formattedAddress === 'string' && firstResult.formattedAddress.trim()
      ? firstResult.formattedAddress.trim()
      : 'address' in input ? input.address : null

    return {
      kind: 'resolved',
      countryCode: extractCountryCode(components),
      pickupArea: extractPickupArea(components),
      formattedAddress,
      latitude,
      longitude,
    }
  } catch {
    console.error(JSON.stringify({ event: 'google_maps_geocode_unavailable' }))
    return { kind: 'provider_error' }
  }
}

function toGoogleWaypoint(input: LocationInput) {
  if ('address' in input) return { address: input.address }

  return {
    location: {
      latLng: {
        latitude: input.latitude,
        longitude: input.longitude,
      },
    },
  }
}

export type DrivingRouteResult =
  | { kind: 'ok'; distanceMeters: number; durationSeconds: number }
  | { kind: 'no_route' }
  | { kind: 'provider_error' }

export async function computeDrivingRoute(
  bindings: GoogleMapsBindings,
  origin: LocationInput,
  destination: LocationInput,
): Promise<DrivingRouteResult> {
  const apiKey = getGoogleMapsApiKey(bindings)
  if (!apiKey) return { kind: 'provider_error' }

  try {
    const response = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': ROUTE_FIELD_MASK,
      },
      body: JSON.stringify({
        origin: toGoogleWaypoint(origin),
        destination: toGoogleWaypoint(destination),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        regionCode: 'UG',
      }),
    })

    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: 'google_maps_route_failed',
          httpStatus: response.status,
        }),
      )
      return { kind: 'provider_error' }
    }

    const data = (await response.json()) as RouteResponse
    const route = data.routes?.[0]
    if (!route) return { kind: 'no_route' }

    const distanceMeters = route.distanceMeters
    const duration = route.duration
    const durationSeconds =
      typeof duration === 'string' && duration.endsWith('s')
        ? Number(duration.slice(0, -1))
        : Number.NaN

    if (
      typeof distanceMeters !== 'number' ||
      !Number.isFinite(distanceMeters) ||
      !Number.isFinite(durationSeconds)
    ) {
      return { kind: 'provider_error' }
    }

    return { kind: 'ok', distanceMeters, durationSeconds }
  } catch {
    console.error(JSON.stringify({ event: 'google_maps_route_unavailable' }))
    return { kind: 'provider_error' }
  }
}
