```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

The `DB` binding points to the `fave-db` D1 database. `wrangler dev` uses a
local D1 database by default; it does not connect to or modify the Cloudflare
database unless remote bindings are explicitly enabled. The `/health` endpoint
checks that the Worker can query D1.

## Better Auth

The Hono Worker mounts Better Auth under `/api/auth/*`. The D1 binding is passed
directly to Better Auth, which provides its native D1 adapter. The Expo plugin
enables mobile OAuth redirects and SecureStore-backed session cookies. The
`/api/me` route is an example of a session-protected API endpoint.

### Local setup

1. Copy `.dev.vars.example` to `.dev.vars` and set `BETTER_AUTH_SECRET` to a
   random value of at least 32 characters. Never commit `.dev.vars`.
2. Add a Google Web OAuth client and set its local callback to
   `http://localhost:8787/api/auth/callback/google`.
3. Run `npm run db:migrate:local` once to create the Better Auth tables in local
   D1, then `npm run dev`.
4. Set `EXPO_PUBLIC_API_URL=http://localhost:8787` for the mobile app. On a
   physical device, use the development machine's reachable LAN address.

### Production provider setup

Set `BETTER_AUTH_URL` to the deployed Worker origin without a trailing slash.
Register these exact callback URLs in each provider:

- Google: `${BETTER_AUTH_URL}/api/auth/callback/google`
- Apple: `${BETTER_AUTH_URL}/api/auth/callback/apple`

In Google Cloud Console, configure the OAuth consent screen (app name Fave,
external audience for public users, and only the `openid`, `email`, and `profile`
scopes), then create a **Web application** OAuth client with the callback above.
Keep its client secret in the Worker secret store.

For Apple, create an App ID with Sign in with Apple enabled, then create a
Service ID, associate it with that App ID, and register the Worker domain and
callback URL. Create a Sign in with Apple key and retain its `.p8` file securely;
Apple only lets you download it once. Set `APPLE_SERVICE_ID`, `APPLE_TEAM_ID`,
`APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` as Worker secrets. The Worker signs the
short-lived Apple client-secret JWT at runtime, so the `.p8` private key stays
out of the repository. Apple requires HTTPS for its return URL.

Store `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`APPLE_SERVICE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`
with `wrangler secret put <NAME>`. Do not put provider secrets in `vars`, app
configuration, or the mobile bundle. Set `BETTER_AUTH_URL` as a Wrangler
non-secret variable to the canonical deployed Worker URL. Apply production
migrations with `npm run db:migrate:remote` after confirming the target database.

The app scheme is `fave`; Better Auth redirects the browser OAuth flow back to
the app and caches the session in Expo SecureStore. Production builds and EAS
development builds use this stable scheme, which is trusted by the production
Worker. Build the iOS simulator development client with
`npx eas-cli@latest build --profile development --platform ios`, then start
Metro with `npx expo start --dev-client`. Use the `development-device` profile
instead when building for a physical iPhone. Both EAS development profiles
currently point to the production auth Worker so they use the already
registered Google and Apple callback URLs; sign-ins from those builds create
sessions in the production auth database.

Expo Go generates temporary `exp://` callback URLs. The production Worker
intentionally rejects those; only a Worker started with
`ENVIRONMENT=development` trusts `exp://**`. Point an Expo Go app at that local
development Worker (`EXPO_PUBLIC_API_URL=http://localhost:8787` in the iOS
simulator) and configure OAuth provider callback URLs for that Worker. For
end-to-end Apple OAuth, use an HTTPS development Worker because Apple requires
HTTPS return URLs. Never add Expo Go callback patterns to the production
Worker's trusted origins.

## Google Maps

The Worker uses Google Maps Geocoding to check whether a pickup address or map
pin is identified as being in Kampala, Mukono, or Wakiso. It uses the Routes API
for driving distance and duration, and only returns the fields the app needs.
The pickup check fails closed if Google cannot verify the country or area.

Enable the Geocoding API and Routes API in the Google Cloud project, create an
API key restricted to those APIs, and set quotas before using it with real
customers. Keep the key in Worker secrets; never put it in Expo app config or
the mobile bundle.

For local development, set `GOOGLE_MAPS_API_KEY` in the ignored `.dev.vars` file
copied from `.dev.vars.example`. For production, run this from `fave-worker`
and enter the key at Wrangler's prompt:

```sh
npx wrangler secret put GOOGLE_MAPS_API_KEY
```

The authenticated `POST /api/maps/pickup-eligibility` endpoint accepts either
`{ "address": "..." }` or `{ "latitude": 0.0, "longitude": 0.0 }`. The
authenticated `POST /api/maps/driving-route` endpoint accepts `origin` and
`destination` with either shape and returns driving distance in meters and
duration in seconds. Neither endpoint logs addresses or coordinates.
