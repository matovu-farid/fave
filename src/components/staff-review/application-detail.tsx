import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import { Link, type Href, useFocusEffect } from 'expo-router'
import { ActionButton, Card, Field, Message, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ApiError } from '@/lib/api'
import { decideReview, getReviewDetail, openReviewEvidence, revealReviewIdentity, type ReviewDetail, type ReviewKind } from '@/lib/staff-review'
import type { ReviewSecurityState } from './security-panel'
import ReviewDecision from './review-decision'
import EvidenceViewer from './evidence-viewer'

type Evidence={url:string;type:string;label:string}
export default function ApplicationDetail({kind,id,access}:{kind:ReviewKind;id:string;access:ReviewSecurityState}) {
  const [detail,setDetail]=useState<ReviewDetail|null>(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(false)
  const [purpose,setPurpose]=useState('')
  const [identity,setIdentity]=useState<Awaited<ReturnType<typeof revealReviewIdentity>>|null>(null)
  const [evidence,setEvidence]=useState<Evidence|null>(null)
  const current=useRef(0)
  const file=useRef<{url:string;request?:AbortController}|null>(null)
  const closeEvidence=useCallback(()=>{file.current?.request?.abort();if(file.current?.url)URL.revokeObjectURL(file.current.url);file.current=null;setEvidence(null)},[])
  const clear=useCallback(()=>{current.current++;closeEvidence();setDetail(null);setIdentity(null);setPurpose('');setMessage('');setBusy(false)},[closeEvidence])
  const refresh=useCallback(async()=>{
    const generation=++current.current;setLoading(true)
    try{const next=await getReviewDetail(kind,id);if(current.current===generation){setDetail(next);setError('')}}
    catch(cause){if(current.current===generation){setDetail(null);setError(cause instanceof Error?cause.message:'Application is unavailable.')}}
    finally{if(current.current===generation)setLoading(false)}
  },[kind,id])
  useEffect(()=>{if(!access.unlocked)return clear;const timer=setTimeout(()=>void refresh(),0);return()=>{clearTimeout(timer);clear()}},[access.unlocked,refresh,clear])
  useFocusEffect(useCallback(()=>()=>clear(),[clear]))
  const failure=async(cause:unknown)=>{
    if(cause instanceof ApiError&&(cause.status===428||cause.status===401||cause.status===403)){clear();await access.refresh()}
    if(cause instanceof ApiError&&cause.status===409){closeEvidence();setIdentity(null);await refresh()}
    setError(cause instanceof Error?cause.message:'Review could not be saved. Try again.')
  }
  const decide=async(documentId:string|null,decision:'approve'|'reject',reason:string,applicantMessage:string)=>{
    if(busy)return
    setBusy(true);setError('');setMessage('')
    const generation=current.current
    try{await decideReview(kind,id,documentId,{decision,reason,applicantMessage});if(generation===current.current){closeEvidence();setIdentity(null);setMessage('Decision saved.');await refresh()}}
    catch(cause){await failure(cause);throw cause}
    finally{setBusy(false)}
  }
  const openFile=async(documentId:string,type:string,label:string)=>{
    if(busy||Platform.OS!=='web')return
    closeEvidence();setBusy(true);setError('')
    const generation=current.current
    const request=new AbortController();file.current={url:'',request}
    try{
      const blob=await openReviewEvidence(kind,id,documentId,purpose.trim(),request.signal)
      if(generation!==current.current||request.signal.aborted)return
      if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(blob.type))throw new Error('This file cannot be displayed safely.')
      const url=URL.createObjectURL(blob);file.current={url,request};setEvidence({url,type,label})
    }catch(cause){if(!request.signal.aborted)await failure(cause)}finally{setBusy(false)}
  }
  const reveal=async()=>{
    if(busy)return
    const generation=current.current;setBusy(true);setError('')
    try{const values=await revealReviewIdentity(kind,id,purpose.trim());if(generation===current.current)setIdentity(values)}
    catch(cause){await failure(cause)}finally{setBusy(false)}
  }
  if(!access.unlocked)return <Message>Unlock reviews to open this application’s details and evidence.</Message>
  return <>
    <Link href={`/admin/${kind}` as Href}><ThemedText type="link">Back to {kind==='drivers'?'driver applications':'vehicle applications'}</ThemedText></Link>
    {error?<Message error>{error}</Message>:null}{message?<Message>{message}</Message>:null}
    {loading?<ActivityIndicator accessibilityLabel="Loading application"/>:null}
    <ActionButton title="Refresh application" disabled={busy} onPress={()=>{clear();void refresh()}}/>
    {detail?<>
      <SectionTitle title={detail.label} detail={detail.status.replaceAll('_',' ')}/>
      {detail.lodgingRateUgx!==undefined?<ThemedText>Registered overnight rate: UGX {detail.lodgingRateUgx?.toLocaleString()??'Not provided'}</ThemedText>:null}
      {detail.reason?<Message>Previous internal review: {detail.reason}</Message>:null}
      {detail.applicantMessage?<Message>Last correction sent: {detail.applicantMessage}</Message>:null}
      <SectionTitle title="Current checklist"/>
      {detail.checklist.map(item=><ThemedText key={item.type}>{item.type.replaceAll('_',' ')} · {item.version}</ThemedText>)}
      {detail.blockers.map(blocker=><Message key={blocker}>{blocker}</Message>)}
      <Card>
        <SectionTitle title="Private evidence" detail="Enter why you need access. Each opening is recorded."/>
        <Field label="Purpose of access" value={purpose} onChangeText={setPurpose} multiline/>
        <ActionButton title={kind==='drivers'?'Open identity details':'Open vehicle registration'} busy={busy} disabled={purpose.trim().length<8||purpose.trim().length>300} onPress={()=>void reveal()}/>
        {identity?<View style={{gap:8}}>
          {identity.nationalIdNumber?<ThemedText>National ID: {identity.nationalIdNumber}</ThemedText>:null}
          {identity.registrationNumber?<ThemedText>Registration: {identity.registrationNumber}</ThemedText>:null}
          {identity.phoneNumber?<ThemedText>Phone: {identity.phoneNumber}</ThemedText>:null}
          <ActionButton title="Hide identity details" onPress={()=>setIdentity(null)}/>
        </View>:null}
        {evidence?<><EvidenceViewer {...evidence}/><ActionButton title="Close evidence" onPress={closeEvidence}/></>:null}
      </Card>
      {detail.documents.map(document=><Card key={document.id}>
        <SectionTitle title={document.type.replaceAll('_',' ')} detail={document.status}/>
        {document.reason?<Message>Internal review: {document.reason}</Message>:null}
        <ActionButton title={`Open ${document.type.replaceAll('_',' ')}`} disabled={purpose.trim().length<8||purpose.trim().length>300} busy={busy} onPress={()=>void openFile(document.id,document.contentType,document.type.replaceAll('_',' '))}/>
        {document.status==='pending'?<ReviewDecision label={document.type.replaceAll('_',' ')} disabled={false} busy={busy} onDecision={(decision,reason,correction)=>decide(document.id,decision,reason,correction)}/>:null}
      </Card>)}
      {['pending_verification','pending_review','needs_correction','rejected'].includes(detail.status)?<Card>
        <SectionTitle title="Application decision" detail={detail.blockers.length?'Resolve approval blockers above. A rejection can include a correction message.':'All current approval checks are complete.'}/>
        <ReviewDecision key={detail.status} label={detail.label} disabled={detail.blockers.length>0} busy={busy} onDecision={(decision,reason,correction)=>decide(null,decision,reason,correction)}/>
      </Card>:<Message>This application is no longer awaiting a decision.</Message>}
    </>:null}
  </>
}
