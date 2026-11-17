// Helpers for shared locations and contacts. Maps use OpenStreetMap tiles (no API key; attribution required).

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
const TILE = 256

/** Web Mercator: where a point falls, in tile units, at zoom z. */
export function tileXY(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  }
}

export interface MapTile {
  url: string
  left: number
  top: number
}

/**
 * The tiles that cover a width x height box centred on the point, with their pixel offsets inside the box.
 * Used to draw a static map preview without a mapping library.
 */
export function tilesAround(lat: number, lng: number, z: number, width: number, height: number): MapTile[] {
  const { x, y } = tileXY(lat, lng, z)
  const n = 2 ** z
  const px = x * TILE - width / 2 // world pixel at the box's left edge
  const py = y * TILE - height / 2
  const tiles: MapTile[] = []
  for (let ty = Math.floor(py / TILE); ty <= Math.floor((py + height - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = Math.floor(px / TILE); tx <= Math.floor((px + width - 1) / TILE); tx++) {
      const wrapped = ((tx % n) + n) % n
      tiles.push({ url: `https://tile.openstreetmap.org/${z}/${wrapped}/${ty}.png`, left: Math.round(tx * TILE - px), top: Math.round(ty * TILE - py) })
    }
  }
  return tiles
}

/** An interactive OpenStreetMap embed with a marker. */
export function osmEmbedUrl(lat: number, lng: number, span = 0.006): string {
  const bbox = [lng - span, lat - span / 2, lng + span, lat + span / 2].map((v) => v.toFixed(6)).join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lng.toFixed(6)}`
}

export const googleMapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
export const directionsUrl = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
export const osmUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`

export const formatCoords = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/**
 * Coordinates typed or pasted: "-33.92, 18.42", or a Google Maps / OpenStreetMap link
 * (".../@-33.92,18.42,15z", "?q=-33.92,18.42", "?mlat=..&mlon=..", "#map=17/-33.92/18.42").
 */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const s = decodeURIComponent(input.trim())
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)'
  const patterns = [
    new RegExp(`@${num},\\s*${num}`),
    new RegExp(`[?&](?:q|query|ll|destination)=${num},\\s*${num}`),
    new RegExp(`mlat=${num}&mlon=${num}`),
    new RegExp(`#map=\\d+/${num}/${num}`),
    new RegExp(`^${num}\\s*[,; ]\\s*${num}$`),
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m) {
      const lat = Number(m[1])
      const lng = Number(m[2])
      if (valid(lat, lng)) return { lat, lng }
    }
  }
  return null
}

/** vCard 3.0 text for "Save contact". */
export function toVCard(c: { name: string; phone?: string; email?: string; org?: string }): string {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
  const parts = c.name.trim().split(/\s+/)
  const last = parts.length > 1 ? parts.pop()! : ''
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(c.name)}`, `N:${esc(last)};${esc(parts.join(' '))};;;`]
  if (c.org) lines.push(`ORG:${esc(c.org)}`)
  if (c.phone) lines.push(`TEL;TYPE=CELL:${esc(c.phone)}`)
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(c.email)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n') + '\r\n'
}

/** Only digits and a leading + for tel: links. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
