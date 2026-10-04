const encoder = new TextEncoder()

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function encodeBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength)
  new Uint8Array(buffer).set(value)
  return buffer
}

async function getKey(secret: string | undefined): Promise<CryptoKey | null> {
  if (!secret) return null
  const raw = decodeBase64(secret)
  if (!raw || raw.byteLength !== 32) return null
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptPrivateField(
  secret: string | undefined,
  plaintext: string,
): Promise<string | null> {
  const key = await getKey(secret)
  if (!key) return null
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, encoder.encode(plaintext),
  )
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`
}

export async function decryptPrivateField(
  secret: string | undefined,
  value: string,
): Promise<string | null> {
  const key = await getKey(secret)
  if (!key) return null
  const [version, encodedIv, encodedCiphertext, ...extra] = value.split('.')
  const iv = encodedIv ? decodeBase64(encodedIv) : null
  const ciphertext = encodedCiphertext ? decodeBase64(encodedCiphertext) : null
  if (version !== 'v1' || extra.length > 0 || !iv || iv.byteLength !== 12 || !ciphertext) return null
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}
