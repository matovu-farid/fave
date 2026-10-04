import type { ExpoConfig, ConfigContext } from 'expo/config'

export default ({ config }: ConfigContext): ExpoConfig => {
  const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_SDK_KEY
  return {
    ...config,
    name: config.name ?? 'fave',
    slug: config.slug ?? 'fave',
    version: config.version ?? '1.0.0',
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}],
    ],
  } as ExpoConfig
}
