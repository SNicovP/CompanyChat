import { describe, expect, it } from 'vitest'
import { CHANNEL_MENTION, mentionsUser, applyMention, displayToTokens, filterPeople, findMentionQuery, splitMentions, tokensToDisplay } from '../app/utils/mentions'

const BOB = '11111111-1111-4111-8111-111111111111'
const JANE = '22222222-2222-4222-8222-222222222222'

describe('splitMentions', () => {
  it('splits text and mention tokens', () => {
    expect(splitMentions(`hi @[${BOB}], see this`)).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'mention', userId: BOB },
      { type: 'text', text: ', see this' },
    ])
  })

  it('leaves plain text and malformed tokens alone', () => {
    expect(splitMentions('mail me @ bob@x.com @[nope]')).toEqual([{ type: 'text', text: 'mail me @ bob@x.com @[nope]' }])
  })
})

describe('display <-> token conversion', () => {
  const names: Record<string, string> = { [BOB]: 'Bob', [JANE]: 'Jane Doe' }
  const nameOf = (id: string) => names[id] ?? 'Unknown'

  it('round-trips a message', () => {
    const body = `@[${BOB}] and @[${JANE}] please review`
    const { text, map } = tokensToDisplay(body, nameOf)
    expect(text).toBe('@Bob and @Jane Doe please review')
    expect(displayToTokens(text, map)).toBe(body)
  })

  it('only converts names the user picked, not lookalike text', () => {
    expect(displayToTokens('@Bobby and @Bob', { Bob: BOB })).toBe(`@Bobby and @[${BOB}]`)
  })

  it('handles names that contain regex characters and prefixes of each other', () => {
    const map = { 'A.B': BOB, 'A.B Long': JANE }
    expect(displayToTokens('@A.B Long and @A.B', map)).toBe(`@[${JANE}] and @[${BOB}]`)
    expect(displayToTokens('@AxB', map)).toBe('@AxB')
  })
})

describe('findMentionQuery', () => {
  it('finds the word being typed after an @', () => {
    expect(findMentionQuery('hello @ja', 9)).toEqual({ start: 6, query: 'ja' })
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
  })

  it('ignores emails, finished words and far-away @s', () => {
    expect(findMentionQuery('mail bob@x.com', 14)).toBeNull()
    expect(findMentionQuery('@bob hello', 10)).toBeNull()
    expect(findMentionQuery('plain text', 5)).toBeNull()
    expect(findMentionQuery(`@${'x'.repeat(31)}`, 32)).toBeNull()
  })
})

describe('applyMention and filterPeople', () => {
  it('replaces the typed query with the full name and moves the caret', () => {
    expect(applyMention('hi @ja there', 3, 6, 'Jane Doe')).toEqual({ text: 'hi @Jane Doe there', caret: 13 })
    expect(applyMention('hi @ja', 3, 6, 'Jane Doe')).toEqual({ text: 'hi @Jane Doe ', caret: 13 })
  })

  it('ranks prefix matches before substring matches and caps the list', () => {
    const people = [{ display_name: 'Maria' }, { display_name: 'Ari' }, { display_name: 'Arnold' }]
    expect(filterPeople(people, 'ar').map((p) => p.display_name)).toEqual(['Ari', 'Arnold', 'Maria'])
    expect(filterPeople(people, '', 2)).toHaveLength(2)
  })
})

describe('@channel', () => {
  it('is split out as its own segment, case-insensitively', () => {
    expect(splitMentions('hi @[channel] and @[Channel]')).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'channel' },
      { type: 'text', text: ' and ' },
      { type: 'channel' },
    ])
  })

  it('round-trips between stored and editable form', () => {
    const { text, map } = tokensToDisplay(`@[channel] meet @[${BOB}]`, () => 'Bob')
    expect(text).toBe('@channel meet @Bob')
    expect(displayToTokens(text, map)).toBe(`@[channel] meet @[${BOB}]`)
  })

  it('converts a hand-typed @channel but not email-like or longer words', () => {
    expect(displayToTokens('@channel hi', {})).toBe('@[channel] hi')
    expect(displayToTokens('a@channel.com @channels', {})).toBe('a@channel.com @channels')
  })

  it('mentionsUser matches personal mentions and @channel', () => {
    expect(mentionsUser(`hi @[${BOB}]`, BOB)).toBe(true)
    expect(mentionsUser('hi @[channel]', BOB)).toBe(true)
    expect(mentionsUser(`hi @[${JANE}]`, BOB)).toBe(false)
    expect(mentionsUser('hi', null)).toBe(false)
    expect(CHANNEL_MENTION).toBe('channel')
  })
})
