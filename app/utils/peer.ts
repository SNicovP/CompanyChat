// One WebRTC connection for a 1:1 voice call. The audio goes directly between the two devices; the set-up
// messages (offer, answer, ICE candidates) are passed through Reverb by whoever creates this (see stores/call.ts).
//
// The caller makes the offer, the callee answers. Candidates that arrive before the remote description is set
// are held and added once it is.

export type Signal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

export interface PeerOptions {
  iceServers: RTCIceServer[]
  /** our microphone */
  stream: MediaStream
  /** the caller makes the offer (and restarts ICE when the connection breaks) */
  caller: boolean
  send: (signal: Signal) => void
  onRemoteStream: (stream: MediaStream) => void
  onState: (state: RTCPeerConnectionState) => void
}

/** Microphone settings for calls: let the browser clean up the voice. */
export const CALL_AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

export const webrtcSupported = () =>
  typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function' && !!navigator.mediaDevices?.getUserMedia

export class CallPeer {
  readonly pc: RTCPeerConnection
  private pending: RTCIceCandidateInit[] = []
  private closed = false

  constructor(private opts: PeerOptions) {
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers })
    for (const track of opts.stream.getTracks()) this.pc.addTrack(track, opts.stream)
    this.pc.onicecandidate = (e) => {
      if (e.candidate) opts.send({ kind: 'ice', candidate: e.candidate.toJSON() })
    }
    this.pc.ontrack = (e) => {
      opts.onRemoteStream(e.streams[0] ?? new MediaStream([e.track]))
    }
    this.pc.onconnectionstatechange = () => {
      if (!this.closed) opts.onState(this.pc.connectionState)
    }
  }

  /** Caller: send the offer. With `iceRestart`, try again to find a path after the connection failed. */
  async offer(iceRestart = false) {
    if (!this.opts.caller || this.closed) return
    const offer = await this.pc.createOffer({ iceRestart })
    await this.pc.setLocalDescription(offer)
    this.opts.send({ kind: 'offer', sdp: offer.sdp ?? '' })
  }

  async handle(signal: Signal) {
    if (this.closed) return
    if (signal.kind === 'ice') {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(signal.candidate).catch(() => {})
      else this.pending.push(signal.candidate)
      return
    }
    if (signal.kind === 'offer') {
      if (this.opts.caller) return // only the caller offers; ignore anything odd
      await this.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
      await this.flush()
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.opts.send({ kind: 'answer', sdp: answer.sdp ?? '' })
      return
    }
    if (!this.opts.caller || this.pc.signalingState !== 'have-local-offer') return
    await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
    await this.flush()
  }

  setMuted(muted: boolean) {
    for (const track of this.opts.stream.getAudioTracks()) track.enabled = !muted
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.pc.onicecandidate = null
    this.pc.ontrack = null
    this.pc.onconnectionstatechange = null
    this.pc.close()
  }

  private async flush() {
    const queued = this.pending
    this.pending = []
    for (const c of queued) await this.pc.addIceCandidate(c).catch(() => {})
  }
}

/** "4:05", or "1:02:09" past an hour. */
export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Why calls between some networks fail until a TURN relay is set up. */
export const NETWORK_HINT = 'Your networks may be blocking direct calls (common on mobile data and strict office firewalls). Try again with both of you on Wi-Fi.'

/**
 * What to tell this person when the other side (or the server) ended the call. Null when nothing needs saying,
 * e.g. the callee declined on another of their own devices.
 */
export function endedNotice(
  call: { status: string; end_reason?: string | null },
  opts: { iAmCaller: boolean; name: string; connectedSeconds: number | null },
): { title: string; description?: string; color?: 'error' | 'warning' } | null {
  const { iAmCaller, name, connectedSeconds } = opts
  switch (call.status) {
    case 'ended':
      if (call.end_reason === 'lost') return { title: 'Call dropped', description: 'The connection was lost.', color: 'warning' }
      return { title: 'Call ended', description: connectedSeconds === null ? `${name} hung up.` : `${name} hung up · ${formatCallDuration(connectedSeconds)}` }
    case 'rejected':
      return iAmCaller ? { title: `${name} declined the call` } : null
    case 'missed':
      return iAmCaller ? { title: 'No answer', description: `${name} didn't pick up.` } : { title: `Missed call from ${name}` }
    case 'cancelled':
      return iAmCaller ? null : { title: `Missed call from ${name}` }
    case 'failed':
      return connectedSeconds === null
        ? { title: "Couldn't connect the call", description: NETWORK_HINT, color: 'error' }
        : { title: 'Call dropped', description: 'The connection was lost.', color: 'warning' }
    default:
      return null
  }
}
