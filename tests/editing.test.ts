import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_LENGTH, checkEdit } from '../app/utils/editing'

describe('checkEdit', () => {
  it('saves a changed message, trimmed', () => {
    expect(checkEdit('  fixed typo ', 'typo', false)).toEqual({ action: 'save', body: 'fixed typo' })
  })

  it('cancels when nothing changed (ignoring surrounding whitespace)', () => {
    expect(checkEdit('same ', ' same', false)).toEqual({ action: 'cancel' })
  })

  it('rejects emptying a message that has no attachment, but allows it when a file is attached', () => {
    expect(checkEdit('  ', 'hello', false).action).toBe('reject')
    expect(checkEdit('', 'hello', true)).toEqual({ action: 'save', body: '' })
  })

  it('rejects over-long messages', () => {
    expect(checkEdit('x'.repeat(MAX_MESSAGE_LENGTH + 1), 'hi', false).action).toBe('reject')
    expect(checkEdit('x'.repeat(MAX_MESSAGE_LENGTH), 'hi', false).action).toBe('save')
  })
})
