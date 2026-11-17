// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAudioUnlock, playStream } from '../app/utils/audio-unlock'

class FakeAudio {
  static allowed = false
  static plays = 0
  autoplay = false
  srcObject: unknown = null
  setAttribute() {}
  pause() {}
  play() {
    FakeAudio.plays++
    return FakeAudio.allowed ? Promise.resolve() : Promise.reject(new DOMException('blocked', 'NotAllowedError'))
  }
}

describe('playStream', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('starts a blocked stream at the next interaction with the page', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    installAudioUnlock()
    const onBlocked = vi.fn()
    const onPlaying = vi.fn()
    playStream({} as MediaStream, { onBlocked, onPlaying })
    await Promise.resolve(); await Promise.resolve()
    expect(onBlocked).toHaveBeenCalledOnce()

    FakeAudio.allowed = true
    window.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve(); await Promise.resolve()
    expect(onPlaying).toHaveBeenCalledOnce()
    expect(FakeAudio.plays).toBe(2)
  })

  it('does not restart a stopped stream', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    FakeAudio.allowed = false
    FakeAudio.plays = 0
    const stop = playStream({} as MediaStream)
    await Promise.resolve(); await Promise.resolve()
    stop()
    FakeAudio.allowed = true
    window.dispatchEvent(new Event('keydown'))
    expect(FakeAudio.plays).toBe(1)
  })
})
