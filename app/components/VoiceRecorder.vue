<script setup lang="ts">
// Records a voice note in place of the composer: live level meter and timer, then a preview to listen to before sending.
const MAX_SECONDS = 10 * 60

const emit = defineEmits<{ send: [file: File]; cancel: [] }>()
const toast = useToast()

type State = 'starting' | 'recording' | 'paused' | 'review'
const state = ref<State>('starting')
const elapsed = ref(0)
const levels = ref<number[]>(Array(32).fill(0.06))
const previewUrl = ref<string | null>(null)

let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let audioCtx: AudioContext | null = null
let raf = 0
let tick: ReturnType<typeof setInterval> | undefined
let file: File | null = null
let sendWhenStopped = false

async function start() {
  if (!canRecord()) {
    toast.add({ title: 'Voice notes are not supported here', description: 'This browser cannot record audio.', color: 'warning' })
    return emit('cancel')
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (e) {
    toast.add({ title: 'Microphone unavailable', description: mediaErrorMessage(e, 'microphone'), color: 'error' })
    return emit('cancel')
  }
  const mimeType = pickRecordingType('audio')
  recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48_000 })
  chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = finish
  recorder.start(250)
  state.value = 'recording'
  tick = setInterval(() => {
    if (state.value !== 'recording') return
    elapsed.value += 0.25
    if (elapsed.value >= MAX_SECONDS) stop()
  }, 250)
  meter()
}

// Live input level, drawn as bars that scroll left.
function meter() {
  try {
    audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    audioCtx.createMediaStreamSource(stream!).connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    let last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 90 || state.value !== 'recording') return
      last = t
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
      levels.value = [...levels.value.slice(1), Math.max(0.06, Math.min(1, peak * 1.8))]
    }
    raf = requestAnimationFrame(draw)
  } catch {
    // no meter; recording still works
  }
}

function pauseResume() {
  if (!recorder) return
  if (state.value === 'recording') { recorder.pause(); state.value = 'paused' }
  else if (state.value === 'paused') { recorder.resume(); state.value = 'recording' }
}

function stop() {
  if (recorder && recorder.state !== 'inactive') recorder.stop()
}

function finish() {
  cleanup(false)
  const type = baseType(recorder?.mimeType || chunks[0]?.type || 'audio/webm')
  const blob = new Blob(chunks, { type })
  if (!blob.size) {
    toast.add({ title: 'Nothing was recorded', color: 'warning' })
    return emit('cancel')
  }
  file = new File([blob], `${VOICE_NOTE_PREFIX}${stamp()}.${extensionFor(type)}`, { type })
  if (sendWhenStopped) return emit('send', file)
  previewUrl.value = URL.createObjectURL(blob)
  state.value = 'review'
}

/** Send straight from recording, or after listening back. */
function send() {
  if (state.value === 'review' && file) return emit('send', file)
  sendWhenStopped = true
  stop()
}

function discard() {
  if (recorder) recorder.onstop = null
  stop()
  emit('cancel')
}

function cleanup(all: boolean) {
  clearInterval(tick)
  cancelAnimationFrame(raf)
  void audioCtx?.close().catch(() => {})
  audioCtx = null
  stopStream(stream)
  stream = null
  if (all && previewUrl.value) URL.revokeObjectURL(previewUrl.value)
}

onMounted(start)
onBeforeUnmount(() => {
  if (recorder) recorder.onstop = null
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  cleanup(true)
})
</script>

<template>
  <div class="flex items-center gap-2" role="group" aria-label="Voice note">
    <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" aria-label="Discard voice note" @click="discard" />
    <template v-if="state === 'review'">
      <AudioPlayer :src="previewUrl ?? undefined" voice class="flex-1" />
    </template>
    <template v-else>
      <div class="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-elevated/70 px-3 py-2">
        <span class="relative flex size-2.5 shrink-0">
          <span v-if="state === 'recording'" class="absolute inline-flex size-full animate-ping rounded-full bg-error opacity-75" />
          <span class="relative inline-flex size-2.5 rounded-full" :class="state === 'recording' ? 'bg-error' : 'bg-muted'" />
        </span>
        <span class="w-12 shrink-0 text-sm tabular-nums text-highlighted" aria-live="off">{{ formatDuration(elapsed) }}</span>
        <div class="flex h-7 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden="true">
          <span
            v-for="(l, i) in levels"
            :key="i"
            class="w-[3px] shrink-0 rounded-full transition-[height] duration-100"
            :class="state === 'recording' ? 'bg-primary' : 'bg-accented'"
            :style="{ height: `${Math.round(l * 100)}%` }"
          />
        </div>
        <span class="hidden text-xs text-muted sm:inline">{{ state === 'starting' ? 'Starting…' : state === 'paused' ? 'Paused' : 'Recording' }}</span>
      </div>
      <UButton
        v-if="state !== 'starting'"
        :icon="state === 'paused' ? 'i-lucide-mic' : 'i-lucide-pause'"
        color="neutral"
        variant="ghost"
        :aria-label="state === 'paused' ? 'Resume recording' : 'Pause recording'"
        @click="pauseResume"
      />
      <UButton v-if="state !== 'starting'" icon="i-lucide-square" color="neutral" variant="soft" aria-label="Stop and listen back" title="Stop and listen back" @click="stop" />
    </template>
    <UButton icon="i-lucide-send-horizontal" :disabled="state === 'starting'" aria-label="Send voice note" @click="send" />
  </div>
</template>
