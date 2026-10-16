import { View } from 'react-native'
export default function EvidenceViewer({url,type,label}:{url:string;type:string;label:string}) {
  return <View style={{width:'100%',minHeight:240}}>{type==='application/pdf'
    ? <iframe title={label} src={url} sandbox="" referrerPolicy="no-referrer" style={{width:'100%',height:480,border:0}}/>
    : <img alt={label} src={url} referrerPolicy="no-referrer" style={{width:'100%',maxHeight:560,objectFit:'contain'}}/>}</View>
}
