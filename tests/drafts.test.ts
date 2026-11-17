import { describe, expect, it } from 'vitest'
import { parseDrafts, withDraft } from '../app/utils/drafts'

describe('drafts', () => {
  it('keeps a separate draft per chat and removes it when emptied', () => {
    let book = withDraft({}, 'a', 'hello', {})
    book = withDraft(book, 'b', 'hi @Sam', { Sam: 'u1' })
    expect(book).toEqual({ a: { text: 'hello', map: {} }, b: { text: 'hi @Sam', map: { Sam: 'u1' } } })
    book = withDraft(book, 'a', '   ', {})
    expect(Object.keys(book)).toEqual(['b'])
  })

  it('does not change the book it was given', () => {
    const before = { a: { text: 'x', map: {} } }
    withDraft(before, 'b', 'y', {})
    expect(Object.keys(before)).toEqual(['a'])
  })

  it('caps the number of stored drafts, dropping the oldest', () => {
    let book = {}
    for (let i = 0; i < 105; i++) book = withDraft(book, `c${i}`, 'x', {})
    expect(Object.keys(book)).toHaveLength(100)
    expect(book).not.toHaveProperty('c0')
    expect(book).toHaveProperty('c104')
  })

  it('parses stored JSON defensively', () => {
    expect(parseDrafts(null)).toEqual({})
    expect(parseDrafts('not json')).toEqual({})
    expect(parseDrafts('[1,2]')).toEqual({})
    expect(parseDrafts('{"a":{"text":"x","map":{}}}')).toEqual({ a: { text: 'x', map: {} } })
  })
})
