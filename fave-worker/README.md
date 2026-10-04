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

## Driver marketplace and trip requests

The marketplace routes are backed by the D1 migrations in `migrations/`.
Apply them locally with `npm run db:migrate:local` and remotely only after the
production migration target has been reviewed. Configure the private R2 bucket
named `fave-private-driver-files` before accepting driver ID or vehicle files;
the bucket must not have public access enabled. `wrangler.jsonc` binds it as
`DRIVER_FILES`. An Images binding is also required for vehicle listing photos:
the Worker converts them to WebP before writing them to the private bucket, so
embedded metadata such as EXIF GPS is discarded before client publication.
Previously stored photos are sanitized and rewritten on their first approved
photo read, then marked so subsequent reads skip the transformation.
Driver identity and vehicle verification evidence stays unmodified and private.
Cloudflare Images must be enabled for the Worker on a paid Images plan;
transformation usage is billed per unique source image and parameter set per
calendar month. The Worker uses opaque object keys, checks image/PDF signatures
and file size, and returns customer photos only after individual photo approval.
Only Ugandan citizen drivers may apply in the first release. The application
records the applicant's affirmative eligibility attestation and approval also
requires that attestation. The client trip flow collects profile details and
verified phone information; it does not collect National ID, passport, or
refugee ID documents.

Set `DRIVER_ID_ENCRYPTION_KEY` to a randomly generated base64 encoding of 32
bytes (`openssl rand -base64 32`) as a Worker secret and local `.dev.vars`
value. Submitted national ID numbers are encrypted with AES-GCM before D1
storage; the key is never stored in D1 or the Expo bundle. Keep a protected
backup and plan a key rotation before replacing it, since encrypted IDs cannot
be opened with a different key. An hourly Worker cron removes expired driver ID
images and clears the encrypted ID fields; each completed purge is recorded as
a system audit event.

Before opening applications or bookings, an authorized operator must publish
the counsel-approved `policy_documents`, `driver_verification_requirements`,
`vehicle_verification_requirements`, and active `retention_policies` records in
D1. Add initial `admin_memberships` out-of-band after verifying the operator;
there is no self-service admin promotion route. Driver and vehicle approval
fails closed until their approved checklist and retention rules are present.
Admin rejection APIs accept a private `reason` for the audit record and a separate
`applicantMessage` for the driver; driver status responses never return internal
review notes. Vehicle listing and photo rejection APIs follow the same split, so
driver-facing correction messages are stored separately from staff review notes.
Migration `0009_checklist_requirement_versions.sql` binds submitted driver and
vehicle evidence to the exact approved checklist version. Evidence from an older
version remains private and must be resubmitted before the application or listing
can be approved under a changed checklist. If already-approved driver evidence
expires or no longer matches the checklist, the driver can submit a fresh
application for staff review; client vehicle eligibility remains blocked until
that review is approved. A newer driver terms or privacy version requires explicit
acceptance without another identity-file upload when verification evidence is
still current. Driver evidence records also retain the exact approved retention
policy ID used for that submission, and the driver status view shows its deletion
deadline. Vehicle editing and availability changes also recheck current
driver evidence and policy eligibility on the server, so a stale UI cannot bypass
the listing gate through direct API calls. Drivers can remove an upcoming or active
unavailability block; removals are audited and past blocks are retained in history.
Phone verification records are owned by the phone-verification flow tracked in
issue #22. Client booking disclosures, consent, and the profile gates depend on
the policy and client setup work tracked in #14, #15, and #21.

The trip quote endpoint requires an active, approved `fare_policies` record.
`rules_json` is an object with a non-empty `components` array and integer
`depositBasisPoints` (100–9900). Each component has `key`, `label`, integer
`amount`, and `unit` (`fixed`, `per_kilometer`, `per_night`, or
`per_passenger`). Store all amounts in the smallest currency unit and set the
policy currency to an ISO 4217 code. Confirm with counsel and operations before
activating pricing; the application deliberately contains no default fare.

For browser development, set `WEB_APP_ORIGINS` to a comma-separated list of
exact trusted origins and include the web app origin in the Better Auth
`trustedOrigins` allowlist. Development mode also allows Expo web on
`http://localhost:8081` and `http://127.0.0.1:8081`; production does not. Keep
credentials enabled only with exact origins and never use a wildcard origin.

The native trip form uses the platform map picker for a private pickup pin.
For production Android builds, set the restricted `GOOGLE_MAPS_ANDROID_SDK_KEY`
EAS environment variable; restrict it to the Maps SDK for Android and the Fave
application id plus signing certificate. iOS uses Apple Maps by default. This
client map-rendering key is separate from the restricted server-side
`GOOGLE_MAPS_API_KEY` used for pickup-area validation and route estimates. The
web fallback accepts latitude/longitude coordinates directly.

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
The pickup check fails closed if Google cannot verify the country or area, or if
administrative-area candidates disagree or return incomplete country/area data.

Google Maps Platform requires an active billing account for API use. Before
enabling these APIs for production, review the current [Geocoding API pricing
and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)
and [Routes API pricing and
billing](https://developers.google.com/maps/documentation/routes/usage-and-billing).
Then enable both APIs, create an API key restricted to those APIs, and set
quotas before real-customer use. Keep the key in Worker secrets; never put it
in Expo app config or the mobile bundle.

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
