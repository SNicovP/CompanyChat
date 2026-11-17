import { describe, expect, it } from 'vitest'
import { endedNotice, formatCallDuration, NETWORK_HINT } from '../app/utils/peer'
import { callSummary, messageSummary } from '../app/utils/files'

describe('formatCallDuration', () => {
  it('shows minutes and seconds, and hours past an hour', () => {
    expect(formatCallDuration(0)).toBe('0:00')
    expect(formatCallDuration(65.9)).toBe('1:05')
    expect(formatCallDuration(3729)).toBe('1:02:09')
    expect(formatCallDuration(-3)).toBe('0:00')
  })
})

describe('endedNotice', () => {
  const as = (iAmCaller: boolean, connectedSeconds: number | null = null) => ({ iAmCaller, name: 'Sam', connectedSeconds })

  it('says who hung up and for how long', () => {
    expect(endedNotice({ status: 'ended' }, as(true, 151))).toEqual({ title: 'Call ended', description: 'Sam hung up · 2:31' })
    expect(endedNotice({ status: 'ended', end_reason: 'lost' }, as(false, 10))?.title).toBe('Call dropped')
  })

  it('tells the caller about no answer or a decline, and the callee about a missed call', () => {
    expect(endedNotice({ status: 'missed' }, as(true))?.title).toBe('No answer')
    expect(endedNotice({ status: 'rejected' }, as(true))?.title).toBe('Sam declined the call')
    expect(endedNotice({ status: 'missed' }, as(false))?.title).toBe('Missed call from Sam')
    expect(endedNotice({ status: 'cancelled' }, as(false))?.title).toBe('Missed call from Sam')
  })

  it('stays quiet about what this person did on another device', () => {
    expect(endedNotice({ status: 'rejected' }, as(false))).toBeNull()
    expect(endedNotice({ status: 'cancelled' }, as(true))).toBeNull()
  })

  it('explains a call that could not connect', () => {
    expect(endedNotice({ status: 'failed' }, as(true))).toEqual({ title: "Couldn't connect the call", description: NETWORK_HINT, color: 'error' })
    expect(endedNotice({ status: 'failed' }, as(true, 30))?.title).toBe('Call dropped')
  })
})

describe('call history summaries', () => {
  it('match the API', () => {
    expect(callSummary('ended')).toBe('📞 Voice call')
    expect(callSummary('cancelled')).toBe('📞 Missed call')
    expect(callSummary('rejected')).toBe('📞 Declined call')
    expect(messageSummary({ share: { type: 'call', status: 'missed' } })).toBe('📞 Missed call')
  })
})
