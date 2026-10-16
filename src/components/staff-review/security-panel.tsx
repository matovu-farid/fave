import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { Link, type Href, useFocusEffect } from 'expo-router'
import { ActionButton, Card, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { enrollReviewAuthenticator, enrollReviewPasskey, verifyReviewAuthenticator, verifyReviewPasskey } from '@/lib/review-verification'
import { getReviewSecurity, lockReviews, type ReviewSecurity } from '@/lib/staff-review'
import EnrollmentCode from './enrollment-code'

export function useReviewSecurity() {
  const [security,setSecurity]=useState<ReviewSecurity|null>(null)
  const [error,setError]=useState('')
  const [now,setNow]=useState(()=>Date.now())
  const generation=useRef(0)
  const clear=useCallback(()=>{generation.current++;setSecurity(null)},[])
  const refresh=useCallback(async()=>{
    const current=++generation.current
    try {const result=await getReviewSecurity();if(current===generation.current){setSecurity(result);setError('')}}
    catch(cause){if(current===generation.current){setSecurity(null);setError(cause instanceof Error?cause.message:'Staff security is unavailable.')}}
  },[])
  useFocusEffect(useCallback(()=>{void refresh();return clear},[refresh,clear]))
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  useEffect(()=>{
    if(Platform.OS!=='web')return
    const hide=()=>{if(document.hidden){clear();void lockReviews().catch(()=>undefined)}else void refresh()}
    document.addEventListener('visibilitychange',hide)
    return()=>document.removeEventListener('visibilitychange',hide)
  },[clear,refresh])
  return {security,error,refresh,clear,unlocked:!!security?.unlocked&&!!security.expiresAt&&security.expiresAt>now}
}
export type ReviewSecurityState=ReturnType<typeof useReviewSecurity>
export default function SecurityPanel({state,manage=false}:{state:ReviewSecurityState;manage?:boolean}) {
  const {security,unlocked,refresh,clear}=state
  const [code,setCode]=useState('')
  const [uri,setUri]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const active=useRef(0)
  useFocusEffect(useCallback(()=>{return()=>{active.current++;setUri('');setCode('');setError('')}},[]))
  useEffect(()=>{
    if(Platform.OS!=='web')return
    const hide=()=>{if(document.hidden){active.current++;setUri('');setCode('')}}
    document.addEventListener('visibilitychange',hide)
    return()=>document.removeEventListener('visibilitychange',hide)
  },[])
  const run=async<T,>(action:()=>Promise<T>,success:string,onResult?:(result:T)=>void)=>{
    const current=++active.current;setBusy(true);setError('');setMessage('')
    try{const result=await action();if(current===active.current){onResult?.(result);setCode('');setMessage(success);await refresh()}}
    catch(cause){if(current===active.current)setError(cause instanceof Error?cause.message:'Verification failed. Try again.')}
    finally{setBusy(false)}
  }
  if(Platform.OS!=='web')return <Card><Message>Review applications in the staff browser console at https://api.fave.fidexa.org/admin.</Message></Card>
  return <Card>
    <SectionTitle title={unlocked?'Reviews unlocked':'Unlock private reviews'} detail="Use your passkey or authenticator app. Access lasts ten minutes." />
    {state.error?<Message error>{state.error}</Message>:null}
    {error?<Message error>{error}</Message>:null}{message?<Message>{message}</Message>:null}
    {!security?<ActionButton title="Check staff access" onPress={()=>void refresh()}/>:null}
    {unlocked?<><ThemedText>Locks at {new Date(security!.expiresAt!).toLocaleTimeString()}.</ThemedText><ActionButton title="Lock reviews now" busy={busy} onPress={()=>{clear();setUri('');setCode('');void run(lockReviews,'Reviews are locked.')}}/></>:null}
    {!unlocked&&security?.passkeys.length?<ActionButton title="Use passkey" busy={busy} onPress={()=>void run(verifyReviewPasskey,'Your passkey was verified.')}/>:null}
    {!unlocked&&security?.authenticator||uri?<><Field label={uri?'Confirm authenticator setup code':'Authenticator code'} value={code} onChangeText={value=>setCode(value.replace(/\D/g,'').slice(0,6))} keyboardType="numeric" autoCapitalize="none"/><ActionButton title={uri?'Confirm authenticator':'Use authenticator code'} busy={busy} disabled={code.length!==6} onPress={()=>void run(()=>verifyReviewAuthenticator(code),'Your authenticator was verified.',()=>setUri(''))}/></>:null}
    {uri?<><EnrollmentCode uri={uri}/><ActionButton title="Hide setup code" onPress={()=>{setUri('');setCode('')}}/></>:null}
    {security&&(security.firstEnrollment||(manage&&unlocked))?<>
      <SectionTitle title={security.firstEnrollment?'Set up staff security':'Add another method'} detail="Only your account can use these methods. Keep a second method in case you lose access to the first."/>
      <ActionButton title={security.passkeys.length?'Add backup passkey':'Set up passkey'} busy={busy} onPress={()=>void run(enrollReviewPasskey,'Passkey saved. Use it to unlock reviews.')}/>
      {!security.authenticator?<ActionButton title="Set up authenticator app" busy={busy} onPress={()=>void run(enrollReviewAuthenticator,'Enter the code from your authenticator to finish setup.',result=>{if(result&&'totpURI' in result)setUri(result.totpURI)})}/>:null}
    </>:null}
    {!manage&&security&&!security.firstEnrollment?<Link href={'/admin/review-security' as Href}><ThemedText type="link">Manage staff security</ThemedText></Link>:null}
  </Card>
}
