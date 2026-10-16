import { Hono } from 'hono'
import { createAuth, type AuthBindings } from './auth'
import { apiError, isMarketplaceAdmin, writeMarketplaceAudit } from './marketplace-auth'
import { isReviewMember, reviewOrigin, reviewProof } from './review-access'

const app = new Hono<{ Bindings: AuthBindings }>()
app.use('*', async(c,next)=>{
  c.header('Cache-Control','private, no-store')
  c.header('Pragma','no-cache')
  await next()
})
app.get('/access', async c=>{
  const session=await createAuth(c.env,c.req.raw.headers).api.getSession({headers:c.req.raw.headers,query:{disableCookieCache:true}})
  if(!session) return c.json(apiError('UNAUTHORIZED','Sign in to continue.'),401)
  const [operations,reviews]=await Promise.all([isMarketplaceAdmin(c.env,session.user.id),isReviewMember(c.env,session.user.id)])
  if(!operations&&!reviews) return c.json(apiError('FORBIDDEN','Staff access is required.'),403)
  return c.json({authorized:true,operations,reviews})
})
app.get('/', async c => {
  const session = await createAuth(c.env,c.req.raw.headers).api.getSession({headers:c.req.raw.headers,query:{disableCookieCache:true}})
  if (!session) return c.json(apiError('UNAUTHORIZED','Sign in to continue.'),401)
  if (!await isReviewMember(c.env,session.user.id)) return c.json(apiError('FORBIDDEN','Only an authorized application reviewer can continue.'),403)
  const origin = reviewOrigin(c.env,c.req.raw.headers)
  if (!origin) return c.json(apiError('REVIEW_ORIGIN_INVALID','Open the staff console to continue.'),403)
  const [proof,keys,totp] = await Promise.all([
    reviewProof(c.env,session,origin),
    c.env.DB.prepare('SELECT id, name FROM passkey WHERE userId=? ORDER BY createdAt').bind(session.user.id).all<{id:string;name:string|null}>(),
    c.env.DB.prepare('SELECT id, verified FROM twoFactor WHERE userId=?').bind(session.user.id).first<{id:string;verified:number}>(),
  ])
  return c.json({unlocked:!!proof,expiresAt:proof?.expires_at??null,method:proof?.method??null,
    passkeys:keys.results,authenticator:totp?.verified===1,authenticatorPending:!!totp&&totp.verified!==1,
    firstEnrollment:keys.results.length===0&&totp?.verified!==1})
})
app.post('/lock',async c=>{
  const session=await createAuth(c.env,c.req.raw.headers).api.getSession({headers:c.req.raw.headers,query:{disableCookieCache:true}})
  if(!session) return c.json(apiError('UNAUTHORIZED','Sign in to continue.'),401)
  if(!await isReviewMember(c.env,session.user.id)||!reviewOrigin(c.env,c.req.raw.headers)) return c.json(apiError('FORBIDDEN','Open the staff console to continue.'),403)
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO review_session_locks (session_id,user_id,generation,locked_at) VALUES (?,?,1,?)
      ON CONFLICT(session_id) DO UPDATE SET generation=generation+1,locked_at=excluded.locked_at`)
      .bind(session.session.id,session.user.id,Date.now()),
    c.env.DB.prepare('DELETE FROM review_session_proofs WHERE (session_id=? OR source_session_id=?) AND user_id=?')
      .bind(session.session.id,session.session.id,session.user.id),
  ])
  await writeMarketplaceAudit(c.env,{actorUserId:session.user.id,action:'review_locked',targetType:'review_session',targetId:session.session.id})
  return c.json({locked:true})
})
export default app
