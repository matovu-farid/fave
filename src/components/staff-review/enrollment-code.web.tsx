import AuthenticatorQr from 'react-qr-code'
import { View } from 'react-native'
import { ThemedText } from '@/components/themed-text'
export default function EnrollmentCode({uri}:{uri:string}) {
  const secret=new URL(uri).searchParams.get('secret')
  return <View style={{gap:12,alignItems:'flex-start'}}>
    <ThemedText>Scan this code in your authenticator app, then enter its six-digit code below.</ThemedText>
    <View style={{backgroundColor:'#fff',padding:16}}><AuthenticatorQr value={uri} size={192} /></View>
    <ThemedText type="small">Or enter this setup key manually:</ThemedText>
    <ThemedText selectable>{secret}</ThemedText>
  </View>
}
