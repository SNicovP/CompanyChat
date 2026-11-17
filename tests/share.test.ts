import { describe, expect, it } from 'vitest'
import { parseCoordinates, tileXY, tilesAround, toVCard, telHref } from '../app/utils/share'
import { attachmentKind, formatDuration, messageSummary, validateFile, MAX_FILE_BYTES } from '../app/utils/files'

describe('locations', () => {
  it('reads coordinates from text and map links', () => {
    expect(parseCoordinates('-33.9249, 18.4241')).toEqual({ lat: -33.9249, lng: 18.4241 })
    expect(parseCoordinates('https://www.google.com/maps/place/X/@-33.92,18.42,15z')).toEqual({ lat: -33.92, lng: 18.42 })
    expect(parseCoordinates('https://maps.google.com/?q=-33.92,18.42')).toEqual({ lat: -33.92, lng: 18.42 })
    expect(parseCoordinates('https://www.openstreetmap.org/?mlat=-33.92&mlon=18.42#map=17/-33.92/18.42')).toEqual({ lat: -33.92, lng: 18.42 })
    expect(parseCoordinates('95, 10')).toBeNull()
    expect(parseCoordinates('Cape Town')).toBeNull()
  })

  it('finds map tiles around a point', () => {
    const { x, y } = tileXY(0, 0, 1)
    expect([x, y]).toEqual([1, 1])
    const tiles = tilesAround(-33.92, 18.42, 15, 320, 160)
    expect(tiles.length).toBeGreaterThanOrEqual(2)
    expect(tiles.length).toBeLessThanOrEqual(6)
    expect(tiles.every((t) => t.url.startsWith('https://tile.openstreetmap.org/15/'))).toBe(true)
  })
})

describe('contacts', () => {
  it('writes a vCard and escapes values', () => {
    const card = toVCard({ name: 'Pat van Jones', phone: '+27 82 123', email: 'p@x.co', org: 'Acme, Inc' })
    expect(card).toContain('FN:Pat van Jones\r\n')
    expect(card).toContain('N:Jones;Pat van;;;')
    expect(card).toContain('ORG:Acme\\, Inc')
    expect(telHref('+27 (82) 123-4567')).toBe('tel:+27821234567')
  })
})

describe('media', () => {
  it('sorts attachments into kinds', () => {
    expect(attachmentKind({ mime_type: 'audio/webm', file_name: 'voice-note-2026.webm' })).toBe('voice')
    expect(attachmentKind({ mime_type: 'audio/mpeg', file_name: 'song.mp3' })).toBe('audio')
    expect(attachmentKind({ mime_type: 'video/mp4', file_name: 'a.mp4' })).toBe('video')
    expect(attachmentKind({ mime_type: 'image/svg+xml', file_name: 'a.svg' })).toBe('file')
  })

  it('allows bigger videos than other files', () => {
    expect(validateFile({ name: 'v', size: MAX_FILE_BYTES + 1, type: 'video/mp4' })).toBeNull()
    expect(validateFile({ name: 'd', size: MAX_FILE_BYTES + 1, type: 'application/pdf' })).toMatch(/larger/)
  })

  it('summarises messages without text', () => {
    const att = (mime: string, name: string) => ({ mime_type: mime, file_name: name, deleted_at: null })
    expect(messageSummary({ message_attachments: [att('audio/webm', 'voice-note-1.webm')] })).toBe('🎤 Voice note')
    expect(messageSummary({ message_attachments: [att('image/png', 'a.png'), att('image/png', 'b.png')] })).toBe('📷 Photo +1')
    expect(messageSummary({ share: { type: 'location', label: 'Office' } })).toBe('📍 Office')
    expect(messageSummary({ share: { type: 'contact', name: 'Pat' } })).toBe('👤 Pat')
    expect(messageSummary({})).toBeNull()
    expect(formatDuration(75)).toBe('1:15')
  })
})
