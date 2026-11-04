import { describe, expect, it } from 'vitest'
import { notificationText, shouldNotify, truncate, type NotifyInput } from '../app/utils/notify'

const base: NotifyInput = { fromSelf: false, windowFocused: false, status: 'online', kind: 'project', mentionsMe: false, watching: false }

describe('shouldNotify', () => {
  it('stays quiet for ordinary project messages unless you watch the channel', () => {
    expect(shouldNotify(base)).toBe(false)
    expect(shouldNotify({ ...base, watching: true })).toBe(true)
  })

  it('always notifies for DMs and mentions', () => {
    expect(shouldNotify({ ...base, kind: 'dm' })).toBe(true)
    expect(shouldNotify({ ...base, mentionsMe: true })).toBe(true)
  })

  it('never notifies for your own messages or while the window is focused', () => {
    expect(shouldNotify({ ...base, kind: 'dm', fromSelf: true })).toBe(false)
    expect(shouldNotify({ ...base, kind: 'dm', windowFocused: true })).toBe(false)
  })

  it('respects Do not disturb, but not Busy or Away', () => {
    expect(shouldNotify({ ...base, kind: 'dm', status: 'dnd' })).toBe(false)
    expect(shouldNotify({ ...base, kind: 'dm', status: 'busy' })).toBe(true)
    expect(shouldNotify({ ...base, kind: 'dm', status: 'away' })).toBe(true)
  })
})

describe('notification text', () => {
  const nameOf = (id: string) => (id === '11111111-1111-4111-8111-111111111111' ? 'Bob' : 'Unknown')

  it('titles a DM with the sender and a project with the channel', () => {
    expect(notificationText({ kind: 'dm', senderName: 'Jane', channelName: null, body: 'hi', nameOf })).toEqual({ title: 'Jane', body: 'hi' })
    expect(notificationText({ kind: 'project', senderName: 'Jane', channelName: 'DTE', body: 'hi', nameOf })).toEqual({ title: '# DTE', body: 'Jane: hi' })
  })

  it('shows mentions by name and flattens whitespace', () => {
    const body = '@[11111111-1111-4111-8111-111111111111]\n  look   here'
    expect(notificationText({ kind: 'dm', senderName: 'J', channelName: null, body, nameOf }).body).toBe('@Bob look here')
  })

  it('describes attachment-only messages and truncates long ones', () => {
    expect(notificationText({ kind: 'dm', senderName: 'J', channelName: null, body: '', nameOf }).body).toBe('Sent an attachment')
    expect(truncate('x'.repeat(200))).toHaveLength(140)
    expect(truncate('x'.repeat(200)).endsWith('…')).toBe(true)
  })
})
