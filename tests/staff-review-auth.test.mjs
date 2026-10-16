import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHmac, generateKeyPairSync, createHash, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { availabilityFixture } from './helpers/availability-fixture.mjs'

const require = createRequire(new URL('../fave-worker/package.json', import.meta.url))
const { build } = require('esbuild')
const { symmetricEncrypt } = require('better-auth/crypto')
const { isoCBOR } = require('@simplewebauthn/server/helpers')
const { createOTP } = require('@better-auth/utils/otp')
const directory = mkdtempSync(join(tmpdir(), 'fave-review-auth-'))
let createAuth
const secret = 'synthetic-auth-secret-at-least-32-characters'
const totpSecret = 'synthetic-totp-secret-32-characters'

test.before(async () => {
  const outfile = join(directory, 'auth.mjs')
  await build({ entryPoints: [new URL('../fave-worker/src/auth.ts', import.meta.url).pathname], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  ;({ createAuth } = await import(pathToFileURL(outfile).href))
})
test.after(() => rmSync(directory, { recursive: true, force: true }))

async function setup(t, { reviewer = true, factor = true } = {}) {
  const f = availabilityFixture(t)
  const now = Date.now()
  f.sql.prepare('UPDATE session SET createdAt=?, updatedAt=?, expiresAt=?').run(now, now, now+86400000)
  const env = { DB: f.DB, BETTER_AUTH_URL: 'https://fave.test', BETTER_AUTH_SECRET: secret, ENVIRONMENT: 'production' }
  const auth = createAuth(env)
  const context = await auth.$context
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent('staff-test-token.' + createHmac('sha256',secret).update('staff-test-token').digest('base64'))}`
  if (reviewer) f.insert('review_memberships', {user_id:'staff',active:1,granted_at:1})
  if (factor) {
    f.insert('twoFactor', {id:'staff-totp',userId:'staff',secret:await symmetricEncrypt({key:secret,data:totpSecret}),backupCodes:'[]',verified:1})
    f.sql.exec("UPDATE user SET twoFactorEnabled=1 WHERE id='staff'")
  }
  const request = async (path, body, extra={}) => {
    const headers = new Headers({origin:'https://fave.test',cookie,'content-type':'application/json',...extra})
    const result = await createAuth(env,headers).handler(new Request(`https://fave.test/api/auth${path}`, {method: body===undefined?'GET':'POST',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})}))
    return {status:result.status,body:result.headers.get('content-type')?.includes('json')?await result.json():await result.text(),headers:result.headers}
  }
  return {...f,auth,request,env,cookie}
}

test('real signed auth session resolves without substituting the identity provider', async(t)=>{
  const f=await setup(t)
  assert.equal((await f.auth.api.getSession({headers:new Headers({cookie:f.cookie})})).user.id,'staff')
})

test('ordinary operations members cannot enroll authentication methods',async(t)=>{
  const f=await setup(t,{reviewer:false})
  assert.equal((await f.request('/two-factor/enable',{})).status,403)
  assert.equal((await f.request('/passkey/generate-register-options')).status,403)
})

test('a real authenticator code grants exactly ten minutes of review proof',async(t)=>{
  const f=await setup(t)
  const before=Date.now()
  const result=await f.request('/two-factor/verify-totp',{code:await createOTP(totpSecret).totp()})
  assert.equal(result.status,200,JSON.stringify(result.body))
  const proof=f.sql.prepare('SELECT * FROM review_session_proofs').get()
  assert.ok(proof,'successful code verification must issue server proof')
  assert.equal(proof.session_id,'staff-session')
  assert.equal(proof.method,'totp')
  assert.equal(proof.expires_at-proof.verified_at,600000)
  assert.ok(proof.verified_at>=before)
})

for (const [path, body] of [
  ['/two-factor/verify-backup-code', {code:'test'}],
  ['/two-factor/send-otp', {}], ['/two-factor/verify-otp', {code:'123456'}],
  ['/two-factor/get-totp-uri', {}],
]) test(`alternate endpoint is unavailable: ${path}`, async(t)=>{
  const f=await setup(t)
  assert.equal((await f.request(path,body)).status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
})

test('code replay across concurrent requests issues one proof only',async(t)=>{
  const f=await setup(t)
  const code=await createOTP(totpSecret).totp()
  const results=await Promise.all([f.request('/two-factor/verify-totp',{code}),f.request('/two-factor/verify-totp',{code})])
  assert.deepEqual(results.map(r=>r.status).sort(),[200,403])
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count,1)
})

test('wrong codes and attempts beyond the durable owner limit never unlock',async(t)=>{
  const f=await setup(t)
  let code=0
  const valid=await createOTP(totpSecret).totp()
  for(let i=0;i<10;i++) {
    let invalid=String(code++).padStart(6,'0')
    if(invalid===valid) invalid=String(code++).padStart(6,'0')
    assert.equal((await f.request('/two-factor/verify-totp',{code:invalid})).status,401)
  }
  assert.equal((await f.request('/two-factor/verify-totp',{code:valid})).status,429)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
})

test('security changes need existing proof and cannot remove the final method',async(t)=>{
  const f=await setup(t)
  assert.equal((await f.request('/two-factor/disable',{})).status,403)
  assert.equal((await f.request('/passkey/generate-register-options')).status,403)
  await f.request('/two-factor/verify-totp',{code:await createOTP(totpSecret).totp()})
  assert.equal((await f.request('/two-factor/disable',{})).body.code,'REVIEW_LAST_METHOD')
  assert.equal((await f.request('/passkey/generate-register-options')).status,200)
})

test('pending authenticator setup is verified and proof follows the rotated session',async(t)=>{
  const f=await setup(t,{factor:false})
  const enabled=await f.request('/two-factor/enable',{})
  assert.equal(enabled.status,200,JSON.stringify(enabled.body))
  assert.equal(f.sql.prepare("SELECT twoFactorEnabled FROM user WHERE id='staff'").get().twoFactorEnabled,0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
  const setupSecret=new URL(enabled.body.totpURI).searchParams.get('secret')
  const { symmetricDecrypt }=require('better-auth/crypto')
  const stored=await symmetricDecrypt({key:secret,data:f.sql.prepare('SELECT secret FROM twoFactor').get().secret})
  assert.ok(setupSecret)
  const verified=await f.request('/two-factor/verify-totp',{code:await createOTP(stored).totp()})
  assert.equal(verified.status,200,JSON.stringify(verified.body))
  const proof=f.sql.prepare('SELECT * FROM review_session_proofs').get()
  assert.ok(proof)
  assert.notEqual(proof.session_id,'staff-session')
  assert.equal(f.sql.prepare("SELECT id FROM session WHERE id='staff-session'").get(),undefined)
})

async function assertion(f,{uv=true,rp='fave.test',clientOrigin='https://fave.test',keyUser='staff'}={}) {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  const jwk=publicKey.export({format:'jwk'})
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]))
  f.insert('passkey',{id:'generated-key',userId:keyUser,publicKey:Buffer.from(cose).toString('base64'),credentialID:'dGVzdC1jcmVkZW50aWFs',counter:0,deviceType:'singleDevice',backedUp:0})
  const options=await f.request('/passkey/generate-authenticate-options')
  assert.equal(options.status,200,JSON.stringify(options.body))
  assert.equal(options.body.userVerification,'required')
  const clientData=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.body.challenge,origin:clientOrigin,crossOrigin:false}))
  const authData=Buffer.concat([createHash('sha256').update(rp).digest(),Buffer.from([uv?5:1,0,0,0,1])])
  const signature=sign('sha256',Buffer.concat([authData,createHash('sha256').update(clientData).digest()]),privateKey)
  const challengeCookie=options.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  return {body:{response:{id:'dGVzdC1jcmVkZW50aWFs',rawId:'dGVzdC1jcmVkZW50aWFs',type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientData.toString('base64url'),authenticatorData:authData.toString('base64url'),signature:signature.toString('base64url')}}},headers:{cookie:f.cookie+'; '+challengeCookie}}
}

test('a signed UV passkey grants proof to the newly issued owner session',async(t)=>{
  const f=await setup(t)
  const signed=await assertion(f)
  const result=await f.request('/passkey/verify-authentication',signed.body,signed.headers)
  assert.equal(result.status,200,JSON.stringify(result.body))
  const proof=f.sql.prepare('SELECT * FROM review_session_proofs').get()
  assert.equal(proof.session_id,result.body.session.id)
  assert.notEqual(proof.session_id,'staff-session')
  assert.equal(proof.method,'passkey')
  assert.equal((await f.request('/passkey/verify-authentication',signed.body,signed.headers)).status,403)
})

for(const options of [{uv:false},{rp:'wrong.test'},{clientOrigin:'https://wrong.test'},{keyUser:'client-1'}]) {
  test(`passkey rejects mismatched signed verification: ${JSON.stringify(options)}`,async(t)=>{
    const f=await setup(t)
    const signed=await assertion(f,options)
    const result=await f.request('/passkey/verify-authentication',signed.body,signed.headers)
    assert.notEqual(result.status,200)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
  })
}

test('passkey challenge cannot migrate to another owner session',async(t)=>{
  const f=await setup(t)
  const signed=await assertion(f)
  f.insert('session',{id:'other-owner-session',userId:'staff',token:'other-owner-token',createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+86400000})
  signed.headers.cookie=signed.headers.cookie.replace(encodeURIComponent('staff-test-token.'+createHmac('sha256',secret).update('staff-test-token').digest('base64')),encodeURIComponent('other-owner-token.'+createHmac('sha256',secret).update('other-owner-token').digest('base64')))
  const result=await f.request('/passkey/verify-authentication',signed.body,signed.headers)
  assert.equal(result.status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
})

for(const method of ['totp','passkey'])test(`a lock wins over ${method} verification already in flight`,async(t)=>{
  const f=await setup(t)
  const signed=method==='passkey'?await assertion(f):null
  const batch=f.DB.batch.bind(f.DB)
  f.DB.batch=async statements=>{
    // Only the proof transaction: a lock occurs after verification began.
    if(statements.some(s=>s.query.includes('INSERT INTO review_session_proofs'))) f.sql.prepare('INSERT OR REPLACE INTO review_session_locks (session_id,user_id,generation,locked_at) VALUES (?,?,?,?)').run('staff-session','staff',1,Date.now())
    return batch(statements)
  }
  const result=signed?await f.request('/passkey/verify-authentication',signed.body,signed.headers):await f.request('/two-factor/verify-totp',{code:await createOTP(totpSecret).totp()})
  assert.equal(result.status,403,JSON.stringify(result.body))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM marketplace_audit_events').get().count,0)
})

test('first passkey enrollment requires signed device verification and does not itself unlock',async(t)=>{
  const f=await setup(t,{factor:false})
  const {publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  const jwk=publicKey.export({format:'jwk'})
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]))
  const options=await f.request('/passkey/generate-register-options')
  assert.equal(options.status,200,JSON.stringify(options.body))
  assert.equal(options.body.authenticatorSelection.userVerification,'required')
  const credential=Buffer.from('synthetic-enrolled-credential')
  const length=Buffer.alloc(2);length.writeUInt16BE(credential.length)
  const authData=Buffer.concat([createHash('sha256').update('fave.test').digest(),Buffer.from([0x45,0,0,0,0]),Buffer.alloc(16),length,credential,Buffer.from(cose)])
  const attestation=isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]]))
  const clientData=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.body.challenge,origin:'https://fave.test'}))
  const result=await f.request('/passkey/verify-registration',{response:{id:credential.toString('base64url'),rawId:credential.toString('base64url'),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:clientData.toString('base64url'),attestationObject:Buffer.from(attestation).toString('base64url'),transports:['internal']}}},{cookie:f.cookie+'; '+options.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')})
  assert.equal(result.status,200,JSON.stringify(result.body))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM passkey').get().count,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
})

test('locking while the browser passkey prompt is open invalidates the outstanding challenge',async(t)=>{
  const f=await setup(t)
  const signed=await assertion(f)
  f.insert('review_session_locks',{session_id:'staff-session',user_id:'staff',generation:1,locked_at:Date.now()})
  const result=await f.request('/passkey/verify-authentication',signed.body,signed.headers)
  assert.equal(result.status,403,JSON.stringify(result.body))
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM review_session_proofs').get().count,0)
})

test('first enrollment rejects a stale social session',async(t)=>{
  const f=await setup(t,{factor:false})
  f.sql.prepare("UPDATE session SET createdAt=? WHERE id='staff-session'").run(Date.now()-600001)
  assert.equal((await f.request('/two-factor/enable',{})).status,403)
  assert.equal((await f.request('/passkey/generate-register-options')).status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM twoFactor').get().count,0)
})
