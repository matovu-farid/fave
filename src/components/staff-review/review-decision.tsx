import { useState } from 'react'
import { View } from 'react-native'
import { ActionButton, Field, Message } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
export default function ReviewDecision({label,disabled,busy,onDecision}:{label:string;disabled:boolean;busy:boolean;onDecision:(decision:'approve'|'reject',reason:string,applicantMessage:string)=>Promise<void>}) {
  const [editing,setEditing]=useState(false)
  const [decision,setDecision]=useState<'approve'|'reject'|null>(null)
  const [reason,setReason]=useState('')
  const [correction,setCorrection]=useState('')
  if(!editing)return <ActionButton title={`Review ${label}`} disabled={busy} onPress={()=>setEditing(true)}/>
  return <View style={{gap:12}}>
    <Field label={`Internal review reason for ${label}`} value={reason} onChangeText={setReason} multiline/>
    <Field label={`Correction message for the driver about ${label} (required for rejection)`} value={correction} onChangeText={setCorrection} multiline/>
    <ActionButton title="Approve" disabled={disabled||busy||reason.trim().length<4||reason.trim().length>300} onPress={()=>setDecision('approve')}/>
    <ActionButton title="Reject" disabled={busy||reason.trim().length<4||reason.trim().length>300||correction.trim().length<4||correction.trim().length>300} onPress={()=>setDecision('reject')}/>
    {!decision?<ActionButton title="Cancel review" disabled={busy} onPress={()=>{setEditing(false);setReason('');setCorrection('')}}/>:null}
    {decision?<>
      <ThemedText type="smallBold">Confirm {decision}: {label}</ThemedText>
      <Message>{decision==='reject'?'The correction message will be shared with the driver.':'This decision updates the application review.'}</Message>
      <ActionButton title={`Confirm ${decision} for ${label}`} busy={busy} onPress={()=>void onDecision(decision,reason.trim(),correction.trim()).then(()=>{setDecision(null);setReason('');setCorrection('');setEditing(false)}).catch(()=>undefined)}/>
      <ActionButton title="Cancel decision" disabled={busy} onPress={()=>setDecision(null)}/>
    </>:null}
  </View>
}
