import MapView, { Marker, type MapPressEvent } from 'react-native-maps'
import { StyleSheet } from 'react-native'

import type { MapCoordinate } from './pickup-map'

export default function PickupMap({ value, onChange }: {
  value: MapCoordinate | null
  onChange: (coordinate: MapCoordinate) => void
}) {
  const setFromEvent = (event: MapPressEvent) => onChange(event.nativeEvent.coordinate)
  return <MapView
    accessibilityLabel="Pickup map. Tap the map to place a private pickup pin."
    style={styles.map}
    initialRegion={{ latitude: 0.3476, longitude: 32.5825, latitudeDelta: 0.12, longitudeDelta: 0.12 }}
    onPress={setFromEvent}
  >
    {value ? <Marker coordinate={value} draggable onDragEnd={(event) => onChange(event.nativeEvent.coordinate)} title="Pickup pin" /> : null}
  </MapView>
}

const styles = StyleSheet.create({ map: { width: '100%', height: 260, borderRadius: 14, overflow: 'hidden' } })
