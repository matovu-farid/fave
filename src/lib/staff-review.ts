import { authenticatedFetch, apiBaseUrl, ApiError } from './api'

export type ReviewKind = 'drivers' | 'vehicles'
export type ReviewQueueItem = { id:string; label:string; status:string; submittedAt?:number|null; progress:{approved:number;total:number} }
export type ReviewDocument = { id:string;type:string;status:string;reason:string|null;contentType:string;requirementVersion:string|null }
export type ReviewDetail = {id:string;label:string;status:string;reason:string|null;applicantMessage:string|null;documents:ReviewDocument[];checklist:{type:string;version:string}[];blockers:string[];lodgingRateUgx?:number|null}
export type ReviewSecurity = {unlocked:boolean;expiresAt:number|null;method:'passkey'|'totp'|null;passkeys:{id:string;name:string|null}[];authenticator:boolean;authenticatorPending:boolean;firstEnrollment:boolean}
const jsonPost = (body:unknown):RequestInit => ({method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const requestReviewLock = () => authenticatedFetch('/api/admin/review-security/lock',{...jsonPost({}),keepalive:true})
// Review routes share this barrier: navigating cannot outrun a pending lock.
// Persist only the revocation intent, so a reload retries an interrupted lock.
const reviewLockKey='fave:review-lock-required'
function savedReviewLock() {
  try{return typeof sessionStorage!=='undefined'&&sessionStorage.getItem(reviewLockKey)==='1'}catch{return false}
}
function saveReviewLock(required:boolean) {
  try{if(typeof sessionStorage!=='undefined'){if(required)sessionStorage.setItem(reviewLockKey,'1');else sessionStorage.removeItem(reviewLockKey)}}catch{/* Storage can be unavailable; retain the in-memory barrier. */}
}
let reviewLockRequired=savedReviewLock()
let pendingReviewLock:Promise<void>|null=null
async function finishReviewLock() {
  if(!reviewLockRequired)return
  if(!pendingReviewLock){
    pendingReviewLock=requestReviewLock()
      .then(()=>{reviewLockRequired=false;saveReviewLock(false)})
      .catch(()=>{throw new Error('Reviews could not be locked. Check your connection and try again.')})
      .finally(()=>{pendingReviewLock=null})
  }
  await pendingReviewLock
}
export function lockReviews() {
  reviewLockRequired=true
  saveReviewLock(true)
  return finishReviewLock()
}
export async function getReviewSecurity() {
  await finishReviewLock()
  return authenticatedFetch<ReviewSecurity>('/api/admin/review-security',{cache:'no-store'})
}
export async function getReviewQueue(kind:ReviewKind) {
  const result=await authenticatedFetch<{applications?:ReviewQueueItem[];vehicles?:ReviewQueueItem[]}>(`/api/admin/${kind}/pending`,{cache:'no-store'})
  return result.applications??result.vehicles??[]
}
export const getReviewDetail = (kind:ReviewKind,id:string) => authenticatedFetch<ReviewDetail>(`/api/admin/${kind}/${encodeURIComponent(id)}/review`,{cache:'no-store'})
export const revealReviewIdentity = (kind:ReviewKind,id:string,reason:string) => authenticatedFetch<{nationalIdNumber?:string;registrationNumber?:string;legalName?:string;phoneNumber?:string}>(`/api/admin/${kind}/${encodeURIComponent(id)}/identity-review`,jsonPost({reason}))
export const decideReview = (kind:ReviewKind,id:string,documentId:string|null,body:{decision:'approve'|'reject';reason:string;applicantMessage:string}) => authenticatedFetch(`/api/admin/${kind}/${encodeURIComponent(id)}${documentId?`/${kind==='drivers'?'documents':'media'}/${encodeURIComponent(documentId)}`:''}/decision`,jsonPost(body))
export async function openReviewEvidence(kind:ReviewKind,id:string,documentId:string,reason:string,signal:AbortSignal) {
  const result=await fetch(new URL(`/api/admin/${kind}/${encodeURIComponent(id)}/${kind==='drivers'?'documents':'media'}/${encodeURIComponent(documentId)}/access`,apiBaseUrl),{...jsonPost({reason}),credentials:'include',signal})
  if(!result.ok) {
    const body=await result.json().catch(()=>null)
    throw new ApiError(body?.error?.message??'Evidence could not be opened.',body?.error?.code,result.status)
  }
  return result.blob()
}
