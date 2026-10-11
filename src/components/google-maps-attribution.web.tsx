import { Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'

export function GoogleMapsAttribution() {
  const theme = useTheme()

  return (
    <span
      aria-label="Google Maps"
      translate="no"
      style={{
        color: theme.background === '#000000' ? '#FFFFFF' : '#5E5E5E',
        display: 'block',
        fontFamily: 'Roboto, sans-serif',
        fontSize: 12,
        fontWeight: 400,
        letterSpacing: 0,
        lineHeight: '16px',
        marginTop: -Spacing.two,
        whiteSpace: 'nowrap',
      }}
    >
      Google Maps
    </span>
  )
}
