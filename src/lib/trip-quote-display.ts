type QuoteComponentLabel = { label: string }

const driverAccommodationNotice = 'The nightly accommodation allowance is paid to your driver for lodging of any kind. Fave does not arrange or pay for your accommodation.'

export function getDriverAccommodationNotice(components: readonly QuoteComponentLabel[]): string | null {
  return components.some(({ label }) => /\b(accommodation|lodging)\b/iu.test(label))
    ? driverAccommodationNotice
    : null
}
