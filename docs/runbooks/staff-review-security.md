# Owner staff-review security

The browser console is `https://api.fave.fidexa.org/admin`. Clients/drivers retain
Google and Apple sign-in. A separate reviewer membership and a fresh ten-minute
passkey or authenticator verification protect identity review and decisions.

## Provision the owner

An operator must resolve the owner's existing Better Auth user ID from the
owner-confirmed sign-in identity and independently check it belongs to the owner.
Do not grant roles from an email domain, a client parameter or an automatic login
hook. The schema migration grants nobody access. Ordinary operations membership
never grants ID review access.

Use a parameterized operator script or a reviewed SQL file with the verified
stable user ID and actor ID, in a single D1 batch:

```sql
INSERT INTO review_memberships (user_id,active,granted_at,granted_by)
VALUES (?1,1,?2,?3)
ON CONFLICT(user_id) DO UPDATE SET active=1,granted_at=excluded.granted_at,granted_by=excluded.granted_by;
INSERT INTO marketplace_audit_events
(id,actor_user_id,actor_type,action,target_type,target_id,reason,created_at)
VALUES (?4,?3,'user','reviewer_granted','reviewer',?1,'Owner-approved initial reviewer',?2);
```

Bind current epoch milliseconds, a fresh UUID and verified IDs. Do not paste real
IDs or session cookies into issue comments. Provision general operations access
separately only if needed; the review role can reach its own screens without it.

## Enrollment and daily use

1. Sign into the canonical browser console again immediately before first setup.
2. Choose Set up passkey or Set up authenticator app. The owner completes the
   device prompt/credential creation, or scans the locally rendered QR and enters
   the first code. Never transmit the QR/secret to an external QR service.
3. Verify the saved method to unlock reviews. Authenticator setup verification can
   also unlock. Merely registering a passkey grants no proof.
4. Add the other method or a backup passkey after unlocking. The final usable
   method cannot be removed; database guards cover concurrent removals.
5. Lock now when finished. Backgrounding the page clears private content and
   requests a lock. Leaving an application clears its private view. Each server
   request still enforces membership, live session, method, origin and expiry.

Localhost passkeys are independent from production credentials. Use the canonical
production origin for real setup. There is no email, SMS, backup-code or password
shortcut to review access. Normal social sign-in alone never unlocks reviews.

## Lost access or suspected compromise

An authorized operator verifies the owner's identity outside the lost account
before recovery. Record the reason and actor in the audit. Revoke the review
membership first, revoke all owner sessions/proofs and invalidate outstanding
review challenges. Only then remove compromised passkeys/authenticator records
and reset the user's twoFactorEnabled flag. This ordering intentionally satisfies
the last-method guards without disabling the guards. Re-provision the verified
stable user ID with a new granted_at timestamp and require fresh owner sign-in
and enrollment. Never add a public self-promotion/recovery endpoint.

## Deployment and rollback

Run tests, Expo lint, both TypeScript checks, `npm run build:staff-web`, and
Worker `wrangler deploy --dry-run --minify`. Export contains public code/assets
only. `/api/*` and `/health` run before asset handling; unknown API paths remain
JSON404. Admin HTML uses private/no-store, same-origin referrers, frame denial
and a CSP allowing only local assets and transient evidence blobs.

Apply migration0020 before deploying the plugin configuration. It is additive;
rolling back Worker code must not drop security tables or triggers. Preserve the
prior Worker version and bindings for rollback. Verify unauthenticated review
APIs reject access, API404 remains JSON, health passes, static review routes load,
and no fare/client policy is activated. Owner enrollment and a real browser
ceremony remain required acceptance evidence after code and synthetic tests pass.

The development dependency audit reports existing advisories in the Wrangler /
Miniflare / sharp / undici toolchain. They are separate from the pinned Better Auth
runtime; do not use `npm audit fix --force` to change authentication or Expo
versions incidentally. Track the tooling update separately before relying on an
untrusted local development input.
