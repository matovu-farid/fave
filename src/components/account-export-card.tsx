import { Link, type Href } from 'expo-router'
import { Card, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'

export default function AccountExportCard() {
  return <Card>
    <SectionTitle title="Download my information" />
    <ThemedText>Get a private ZIP of your Fave account, both profiles and retained uploads. Contains private information, including your ID uploads; save it somewhere secure.</ThemedText>
    <Link href={'/account/export' as Href}><ThemedText type="link">Open account downloads</ThemedText></Link>
  </Card>
}
