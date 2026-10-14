import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { createTripDraftStore } from '@/lib/trip-draft'

const key = 'fave-trip-draft-v1'

export const tripDraftStore = createTripDraftStore({
  async getItem(itemKey) {
    if (Platform.OS === 'web') {
      try { return typeof window === 'undefined' ? null : window.sessionStorage.getItem(itemKey) }
      catch { return null }
    }
    return SecureStore.getItemAsync(itemKey)
  },
  async setItem(itemKey, value) {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.sessionStorage.setItem(itemKey, value)
      return
    }
    await SecureStore.setItemAsync(itemKey, value)
  },
  async removeItem(itemKey) {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.sessionStorage.removeItem(itemKey)
      return
    }
    await SecureStore.deleteItemAsync(itemKey)
  },
}, key)
