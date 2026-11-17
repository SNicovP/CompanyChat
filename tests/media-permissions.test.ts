import { describe, expect, it } from 'vitest'
import { mediaErrorMessage } from '../app/utils/recording'

const err = (name: string, message = '') => Object.assign(new Error(message), { name })
const mac = { mac: true, standalone: false, desktop: false, safari: false }

describe('mediaErrorMessage', () => {
  it('points at macOS privacy settings when the system blocked the browser or app', () => {
    const denied = err('NotAllowedError', 'Permission denied by system')
    expect(mediaErrorMessage(denied, 'microphone', mac)).toContain('System Settings › Privacy & Security › Microphone, turn on your browser')
    expect(mediaErrorMessage(denied, 'microphone', { ...mac, desktop: true })).toContain('turn on CompanyChat')
    expect(mediaErrorMessage(denied, 'camera', { ...mac, safari: true })).toContain('› Camera, turn on Safari')
  })

  it('tells an installed app, Safari and a tab where the site permission lives', () => {
    const denied = err('NotAllowedError', 'Permission denied')
    expect(mediaErrorMessage(denied, 'microphone', { ...mac, standalone: true })).toContain('App info')
    expect(mediaErrorMessage(denied, 'microphone', { ...mac, safari: true })).toContain('Safari › Settings › Websites › Microphone')
    expect(mediaErrorMessage(denied, 'microphone', mac)).toContain('next to the address bar')
  })

  it('asks again after a dismissed prompt, and keeps the device errors', () => {
    expect(mediaErrorMessage(err('NotAllowedError', 'Permission dismissed'), 'microphone', mac)).toBe('The microphone request was closed. Try again and choose Allow.')
    expect(mediaErrorMessage(err('NotFoundError'), 'microphone', mac)).toBe('No microphone was found on this device.')
    expect(mediaErrorMessage(err('NotReadableError'), 'camera', mac)).toBe('Your camera is being used by another app.')
  })
})
