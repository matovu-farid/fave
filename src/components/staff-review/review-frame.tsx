import type { PropsWithChildren } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link, type Href } from 'expo-router'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { MaxContentWidth, Spacing, BottomTabInset } from '@/constants/theme'
export default function ReviewFrame({title,children}:{title:string}&PropsWithChildren) {
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <ScrollView contentContainerStyle={styles.content}>
      <Link href={'/admin' as Href}><ThemedText type="link">Back to operations</ThemedText></Link>
      <ThemedText type="title">{title}</ThemedText>
      {children}
    </ScrollView>
  </SafeAreaView></ThemedView>
}
const styles=StyleSheet.create({fill:{flex:1},content:{width:'100%',maxWidth:MaxContentWidth,alignSelf:'center',padding:Spacing.four,gap:Spacing.three,paddingBottom:BottomTabInset+Spacing.four}})
