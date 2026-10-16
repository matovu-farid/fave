import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'
import { apiBaseUrl } from './auth-client'
const client=createAuthClient({baseURL:apiBaseUrl,plugins:[passkeyClient(),twoFactorClient()]})
function checked<T>(result:{data:T;error:{message?:string}|null}) {
  if(result.error) throw new Error(result.error.message??'Verification failed. Try again.')
  return result.data
}
export const enrollReviewPasskey = async()=>checked(await client.passkey.addPasskey({name:'Fave staff passkey'}))
export const verifyReviewPasskey = async()=>checked(await client.signIn.passkey())
export const enrollReviewAuthenticator = async()=>checked(await client.twoFactor.enable({}))
export const verifyReviewAuthenticator = async(code:string)=>checked(await client.twoFactor.verifyTotp({code,trustDevice:false}))
