import { describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, formatBytes, isInlineImage, safeFileName, validateFile } from '../app/utils/files'

describe('file helpers', () => {
  it('makes storage-safe file names', () => {
    expect(safeFileName('My Report (final).pdf')).toBe('My_Report_final_.pdf')
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(safeFileName('...')).toBe('file')
    expect(safeFileName('é.png')).toBe('_.png')
    expect(safeFileName('a'.repeat(300) + '.png')).toHaveLength(100)
  })

  it('only inlines raster image types, never SVG or HTML', () => {
    expect(isInlineImage('image/png')).toBe(true)
    expect(isInlineImage('image/svg+xml')).toBe(false)
    expect(isInlineImage('text/html')).toBe(false)
    expect(isInlineImage(null)).toBe(false)
  })

  it('validates size', () => {
    expect(validateFile({ name: 'a', size: 1 })).toBeNull()
    expect(validateFile({ name: 'a', size: 0 })).toMatch(/empty/)
    expect(validateFile({ name: 'a', size: MAX_FILE_BYTES + 1 })).toMatch(/larger/)
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
