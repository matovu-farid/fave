import type { AuthBindings } from './auth'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export type StoredPrivateImage = {
  objectKey: string
  contentType: string
  byteSize: number
}

export type StoredPrivateEvidence = StoredPrivateImage

function hasImageSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }

  if (contentType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    )
  }

  return (
    contentType === 'image/webp' &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
}

export function validateImageFile(
  file: File,
): Promise<'image/jpeg' | 'image/png' | 'image/webp' | null> {
  return (async () => {
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      return null
    }

    const signature = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    if (!hasImageSignature(file.type, signature)) return null

    return file.type as 'image/jpeg' | 'image/png' | 'image/webp'
  })()
}

export async function storePrivateImage(
  env: AuthBindings,
  prefix: 'driver-documents' | 'vehicle-documents',
  file: File,
): Promise<StoredPrivateImage | null> {
  const contentType = await validateImageFile(file)
  if (!contentType || !env.DRIVER_FILES) return null

  const objectKey = `${prefix}/${crypto.randomUUID()}`
  try {
    await env.DRIVER_FILES.put(objectKey, file.stream(), {
      httpMetadata: {
        cacheControl: 'private, no-store, max-age=0',
        contentType,
      },
    })
  } catch (error) {
    await env.DRIVER_FILES.delete(objectKey).catch(() => undefined)
    throw error
  }

  return { objectKey, contentType, byteSize: file.size }
}

export async function storePublicVehiclePhoto(
  env: AuthBindings,
  file: File,
): Promise<StoredPrivateImage | null> {
  const contentType = await validateImageFile(file)
  if (!contentType || !env.DRIVER_FILES) return null
  if (!env.IMAGES) throw new Error('Cloudflare Images binding is not configured')

  const objectKey = `vehicle-photos/${crypto.randomUUID()}`
  try {
    const transformed = await env.IMAGES
      .input(file.stream())
      .output({ format: 'image/webp' })
    await env.DRIVER_FILES.put(objectKey, transformed.image(), {
      httpMetadata: {
        cacheControl: 'private, no-store, max-age=0',
        contentType: 'image/webp',
      },
      customMetadata: { vehiclePhotoSanitization: 'webp-v1' },
    })
  } catch (error) {
    await env.DRIVER_FILES.delete(objectKey).catch(() => undefined)
    throw error
  }

  return { objectKey, contentType: 'image/webp', byteSize: file.size }
}

export async function readPublicVehiclePhoto(
  env: AuthBindings,
  objectKey: string,
): Promise<Response | null> {
  if (!env.DRIVER_FILES || !env.IMAGES) return null

  let object = await env.DRIVER_FILES.get(objectKey)
  if (!object) return null

  if (object.customMetadata?.vehiclePhotoSanitization !== 'webp-v1') {
    const transformed = await env.IMAGES.input(object.body).output({ format: 'image/webp' })
    await env.DRIVER_FILES.put(objectKey, transformed.image(), {
      httpMetadata: {
        cacheControl: 'private, no-store, max-age=0',
        contentType: 'image/webp',
      },
      customMetadata: { vehiclePhotoSanitization: 'webp-v1' },
    })
    object = await env.DRIVER_FILES.get(objectKey)
    if (!object) return null
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Type', 'image/webp')
  headers.set('Cache-Control', 'private, no-store, max-age=0')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(object.body, { headers })
}

export async function storePrivateEvidence(
  env: AuthBindings,
  prefix: 'driver-documents' | 'vehicle-documents',
  file: File,
): Promise<StoredPrivateEvidence | null> {
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) return null

  let contentType: string | null = await validateImageFile(file)
  if (file.type === 'application/pdf') {
    const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    contentType = signature.length === 5 && String.fromCharCode(...signature) === '%PDF-'
      ? 'application/pdf'
      : null
  }
  if (!contentType || !env.DRIVER_FILES) return null

  const objectKey = `${prefix}/${crypto.randomUUID()}`
  try {
    await env.DRIVER_FILES.put(objectKey, file.stream(), {
      httpMetadata: {
        cacheControl: 'private, no-store, max-age=0',
        contentType,
      },
    })
  } catch (error) {
    await env.DRIVER_FILES.delete(objectKey).catch(() => undefined)
    throw error
  }

  return { objectKey, contentType, byteSize: file.size }
}

export async function readPrivateEvidence(
  env: AuthBindings,
  objectKey: string,
): Promise<Response | null> {
  if (!env.DRIVER_FILES) return null

  const object = await env.DRIVER_FILES.get(objectKey)
  if (!object) return null

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'private, no-store, max-age=0')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Disposition', headers.get('Content-Type') === 'application/pdf'
    ? 'attachment; filename="private-document.pdf"'
    : 'inline; filename="private-image"')

  return new Response(object.body, { headers })
}

export function supportedImageTypes(): string[] {
  return [...ALLOWED_IMAGE_TYPES]
}
