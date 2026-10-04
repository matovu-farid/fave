import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Field, Message } from '@/components/marketplace-ui'
import { ExternalLink } from '@/components/external-link'
import { ThemedText } from '@/components/themed-text'
import { Spacing } from '@/constants/theme'
import type { MapCoordinate } from './pickup-map'

export default function PickupMap({ value, onChange }: {
  value: MapCoordinate | null
  onChange: (coordinate: MapCoordinate) => void
}) {
  const [coordinates, setCoordinates] = useState(value ? `${value.latitude}, ${value.longitude}` : '')
  const update = (raw: string) => {
    setCoordinates(raw)
    const [latitude, longitude, extra] = raw.split(',')
    if (extra !== undefined || !latitude?.trim() || !longitude?.trim()) return
    const nextLatitude = Number(latitude)
    const nextLongitude = Number(longitude)
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) return
    if (nextLatitude < -90 || nextLatitude > 90 || nextLongitude < -180 || nextLongitude > 180) return
    onChange({ latitude: nextLatitude, longitude: nextLongitude })
  }
  return <View style={styles.box}>
    <ThemedText type="smallBold">Set a pickup pin</ThemedText>
    <Message>Choose a point in Google Maps, copy its coordinates, and paste them here. The server verifies your private pickup pin before creating a quote.</Message>
    <ExternalLink href="https://maps.google.com/" style={styles.mapLink}>Open Google Maps to choose a pin ↗</ExternalLink>
    <Field label="Latitude, longitude" keyboardType="numeric" value={coordinates} onChangeText={update} placeholder="0.3476, 32.5825" />
  </View>
}

const styles = StyleSheet.create({ box: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderColor: '#b8bbc2', borderRadius: 14 }, mapLink: { color: '#175cd3', fontWeight: '600', paddingVertical: Spacing.two } })
