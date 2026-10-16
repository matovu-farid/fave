import { useCallback, useState } from 'react'
import { ActivityIndicator } from 'react-native'
import { Link, type Href, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { ActionButton, Card, Message } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { getReviewQueue, type ReviewKind, type ReviewQueueItem } from '@/lib/staff-review'
import ReviewFrame from './review-frame'
import SecurityPanel, { useReviewSecurity } from './security-panel'
import ApplicationDetail from './application-detail'
export default function ApplicationScreen({kind}:{kind:ReviewKind}) {
  const {id}=useLocalSearchParams<{id?:string}>()
  const selected=typeof id==='string'?id:''
  const access=useReviewSecurity()
  const [items,setItems]=useState<ReviewQueueItem[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const refresh=useCallback(async()=>{setLoading(true);try{setItems(await getReviewQueue(kind));setError('')}catch(cause){setItems([]);setError(cause instanceof Error?cause.message:'Applications are unavailable.')}finally{setLoading(false)}},[kind])
  useFocusEffect(useCallback(()=>{if(!selected)void refresh();return()=>setItems([])},[selected,refresh]))
  return <ReviewFrame title={kind==='drivers'?'Driver applications':'Vehicle applications'}>
    <SecurityPanel state={access}/>
    {selected?<ApplicationDetail key={`${kind}:${selected}`} kind={kind} id={selected} access={access}/>:<>
      <ThemedText>Oldest outstanding applications first. Open one to review its checklist and evidence.</ThemedText>
      <ActionButton title="Refresh applications" busy={loading} onPress={()=>void refresh()}/>
      {loading?<ActivityIndicator accessibilityLabel="Loading applications"/>:null}
      {error?<Message error>{error}</Message>:null}
      {!loading&&!error&&items.length===0?<Message>No applications are waiting for review.</Message>:null}
      {items.map(item=><Card key={item.id}>
        <ThemedText type="subtitle">{item.label}</ThemedText>
        <ThemedText>{item.status.replaceAll('_',' ')} · {item.progress.approved} of {item.progress.total} submitted files approved</ThemedText>
        {item.submittedAt?<ThemedText type="small">Submitted {new Date(item.submittedAt).toLocaleString()}</ThemedText>:null}
        <Link href={{pathname:`/admin/${kind}`,params:{id:item.id}} as Href}><ThemedText type="link">Review {item.label}</ThemedText></Link>
      </Card>)}
      {items.length===100?<Message>Showing the oldest 100 applications. Complete these reviews to see the next submissions.</Message>:null}
    </>}
  </ReviewFrame>
}
