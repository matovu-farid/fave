import { router, type Href } from 'expo-router'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'

import { ActionButton, Card, SectionTitle } from '@/components/marketplace-ui'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme'

const tripSteps = [
  {
    number: '1',
    title: 'Tell us about your journey',
    detail: 'Add your pickup, destination, dates, passenger count, and luggage needs.',
  },
  {
    number: '2',
    title: 'Compare available vehicles',
    detail: 'Choose from approved vehicles that match your trip dates and group size.',
  },
  {
    number: '3',
    title: 'Review your estimate',
    detail: 'Check the route and itemized price before you decide whether to request the trip.',
  },
]

export default function ExploreScreen() {
  return (
    <ThemedView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="smallBold" style={styles.eyebrow}>FAVE · UGANDA</ThemedText>
        <SectionTitle
          title="Explore Uganda"
          detail="Plan a private-car journey around Kampala and across Uganda."
        />
        <Card>
          <ThemedText type="subtitle">How it works</ThemedText>
          {tripSteps.map((step) => (
            <View key={step.number} style={styles.step}>
              <ThemedView type="backgroundSelected" style={styles.stepNumber}>
                <ThemedText type="smallBold">{step.number}</ThemedText>
              </ThemedView>
              <View style={styles.stepCopy}>
                <ThemedText type="smallBold">{step.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{step.detail}</ThemedText>
              </View>
            </View>
          ))}
          <ActionButton title="Plan a trip" onPress={() => router.push('/trips' as Href)} />
        </Card>
      </ScrollView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    paddingTop: Platform.select({ web: Spacing.six }),
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.three,
  },
  eyebrow: { letterSpacing: 2 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  stepNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCopy: { flex: 1, gap: Spacing.one },
})
