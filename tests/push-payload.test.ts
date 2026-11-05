import { describe, expect, it } from 'vitest'
import { buildPush, readableBody, truncate } from '../supabase/functions/_shared/push'

const BOB = '11111111-1111-4111-8111-111111111111'
const nameOf = (id: string) => (id === BOB ? 'Bob' : 'Unknown')
const base = { channelId: 'c1', channelKind: 'project' as const, channelName: 'website', senderName: 'Alice', body: 'hello', showPreview: true, nameOf }

describe('readableBody', () => {
  it('turns mention tokens into names and @channel', () => {
    expect(readableBody(`hi @[${BOB}] and @[channel]`, nameOf)).toBe('hi @Bob and @channel')
  })
  it('says so for attachment-only messages', () => {
    expect(readableBody('   ', nameOf)).toBe('Sent an attachment')
  })
  it('flattens whitespace and truncates', () => {
    expect(readableBody('a\n\n b', nameOf)).toBe('a b')
    expect(truncate('x'.repeat(200))).toHaveLength(140)
    expect(truncate('x'.repeat(200)).endsWith('…')).toBe(true)
  })
})

describe('buildPush', () => {
  it('titles a DM with the sender', () => {
    expect(buildPush({ ...base, kind: 'dm', channelKind: 'dm', channelName: null })).toEqual({ title: 'Alice', body: 'hello', tag: 'c1', url: '/c/c1' })
  })
  it('titles a project message with the channel and prefixes the sender', () => {
    expect(buildPush({ ...base, kind: 'watch' })).toEqual({ title: '# website', body: 'Alice: hello', tag: 'c1', url: '/c/c1' })
  })
  it('hides the text when previews are off', () => {
    expect(buildPush({ ...base, kind: 'watch', showPreview: false }).body).toBe('New message')
    expect(buildPush({ ...base, kind: 'mention', showPreview: false }).body).toBe('Alice mentioned you')
    expect(buildPush({ ...base, kind: 'dm', channelKind: 'dm', showPreview: false }).body).toBe('New message')
  })
})
