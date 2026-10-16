import { authenticatedFetch, apiBaseUrl, ApiError } from './api'

export type ReviewKind = 'drivers' | 'vehicles'
export type ReviewQueueItem = { id:string; label:string; status:string; submittedAt?:number|null; progress:{approved:number;total:number} }
export type ReviewDocument = { id:string;type:string;status:string;reason:string|null;contentType:string;requirementVersion:string|null }
export type ReviewDetail = {id:string;label:string;status:string;reason:string|null;applicantMessage:string|null;documents:ReviewDocument[];checklist:{type:string;version:string}[];blockers:string[];lodgingRateUgx?:number|null}
export type ReviewSecurity = {unlocked:boolean;expiresAt:number|null;method:'passkey'|'totp'|null;passkeys:{id:string;name:string|null}[];authenticator:boolean;authenticatorPending:boolean;firstEnrollment:boolean}
const jsonPost = (body:unknown):RequestInit => ({method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
export const getReviewSecurity = () => authenticatedFetch<ReviewSecurity>('/api/admin/review-security',{cache:'no-store'})
export const lockReviews = () => authenticatedFetch('/api/admin/review-security/lock',jsonPost({}))
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
