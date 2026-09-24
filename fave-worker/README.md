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
