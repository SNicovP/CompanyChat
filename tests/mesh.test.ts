import { describe, expect, it } from 'vitest'
import { linkTo, namesSummary } from '../app/utils/mesh'

describe('linkTo', () => {
  it('connects every pair in a call, with the smaller id offering', () => {
    expect(linkTo({ id: 'a', role: 'member' }, { id: 'b', role: 'member' })).toEqual({ connect: true, offer: true })
    expect(linkTo({ id: 'b', role: 'member' }, { id: 'a', role: 'member' })).toEqual({ connect: true, offer: false })
    expect(linkTo({ id: 'a', role: 'member' }, { id: 'a', role: 'member' }).connect).toBe(false)
  })

  it('in an announcement connects only the speaker to each listener, the speaker offering', () => {
    expect(linkTo({ id: 'z', role: 'speaker' }, { id: 'a', role: 'listener' })).toEqual({ connect: true, offer: true })
    expect(linkTo({ id: 'a', role: 'listener' }, { id: 'z', role: 'speaker' })).toEqual({ connect: true, offer: false })
    expect(linkTo({ id: 'a', role: 'listener' }, { id: 'b', role: 'listener' }).connect).toBe(false)
  })
})

describe('namesSummary', () => {
  it('lists a few names and counts the rest', () => {
    expect(namesSummary([])).toBe('')
    expect(namesSummary(['Pat'])).toBe('Pat')
    expect(namesSummary(['Pat', 'Sam'])).toBe('Pat and Sam')
    expect(namesSummary(['Pat', 'Sam', 'Lee'])).toBe('Pat, Sam and 1 other')
    expect(namesSummary(['Pat', 'Sam', 'Lee', 'Kim'], 3)).toBe('Pat, Sam, Lee and 1 other')
  })
})
