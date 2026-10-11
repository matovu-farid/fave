import { StyleSheet } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'

export function GoogleMapsAttribution() {
  const theme = useTheme()

  return (
    <ThemedText
      accessibilityLabel="Google Maps"
      numberOfLines={1}
      style={[styles.attribution, { color: theme.background === '#000000' ? '#FFFFFF' : '#5E5E5E' }]}
    >
      Google Maps
    </ThemedText>
  )
}

const styles = StyleSheet.create({
  attribution: {
    fontFamily: 'Roboto',
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0,
    lineHeight: 16,
    marginTop: -Spacing.two,
  },
})
