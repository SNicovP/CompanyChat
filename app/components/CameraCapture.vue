<script setup lang="ts">
// Take a photo or record a video with the device camera, then use it or retake. If the camera can't be opened in
// the page (no permission, unsupported), fall back to the system camera via <input capture>.
const MAX_VIDEO_SECONDS = 3 * 60

const props = defineProps<{ mode: 'photo' | 'video' }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ capture: [file: File] }>()
const toast = useToast()

type State = 'starting' | 'live' | 'recording' | 'review' | 'error'
const state = ref<State>('starting')
const errorText = ref('')
const video = ref<HTMLVideoElement | null>(null)
const fallbackInput = ref<HTMLInputElement | null>(null)
const facing = ref<'user' | 'environment'>('environment')
const hasMultipleCameras = ref(false)
const elapsed = ref(0)
const result = ref<{ file: File; url: string } | null>(null)
const flash = ref(false)

let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let tick: ReturnType<typeof setInterval> | undefined

async function startCamera() {
  stopAll()
  state.value = 'starting'
  if (!navigator.mediaDevices?.getUserMedia || (props.mode === 'video' && typeof MediaRecorder === 'undefined')) {
    return fallback()
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing.value, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: props.mode === 'video',
    })
  } catch (e) {
    errorText.value = mediaErrorMessage(e, 'camera')
    state.value = 'error'
    return
  }
  if (!open.value) return stopAll() // closed while asking for permission
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  hasMultipleCameras.value = devices.filter((d) => d.kind === 'videoinput').length > 1
  await nextTick()
  if (video.value) {
    video.value.srcObject = stream
    await video.value.play().catch(() => {})
  }
  state.value = 'live'
}

/** The system camera app (mobile) or a file picker (desktop). */
function fallback() {
  stopAll()
  fallbackInput.value?.click()
}

function onFallbackPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (f) {
    emit('capture', f)
    open.value = false
  }
}

function takePhoto() {
  const v = video.value
  if (!v || !v.videoWidth) return
  const canvas = document.createElement('canvas')
  canvas.width = v.videoWidth
  canvas.height = v.videoHeight
  const ctx = canvas.getContext('2d')!
  if (facing.value === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1) } // save what the mirrored preview showed
  ctx.drawImage(v, 0, 0)
  flash.value = true
  setTimeout(() => (flash.value = false), 150)
  canvas.toBlob((blob) => {
    if (!blob) return
    const file = new File([blob], `photo-${stamp()}.jpg`, { type: 'image/jpeg' })
    showResult(file)
  }, 'image/jpeg', 0.9)
}

function startRecording() {
  if (!stream) return
  const mimeType = pickRecordingType('video')
  try {
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_800_000, audioBitsPerSecond: 96_000 })
  } catch {
    recorder = new MediaRecorder(stream)
  }
  chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = () => {
    const type = baseType(recorder?.mimeType || chunks[0]?.type || 'video/webm')
    const blob = new Blob(chunks, { type })
    if (!blob.size) return
    showResult(new File([blob], `video-${stamp()}.${extensionFor(type)}`, { type }))
  }
  recorder.start(500)
  elapsed.value = 0
  state.value = 'recording'
  tick = setInterval(() => {
    elapsed.value += 1
    if (elapsed.value >= MAX_VIDEO_SECONDS) stopRecording()
  }, 1000)
}

function stopRecording() {
  clearInterval(tick)
  if (recorder && recorder.state !== 'inactive') recorder.stop()
}

function showResult(file: File) {
  const problem = validateFile(file)
  if (problem) {
    toast.add({ title: 'Too large to send', description: problem, color: 'warning' })
    return startCamera()
  }
  stopStream(stream)
  stream = null
  result.value = { file, url: URL.createObjectURL(file) }
  state.value = 'review'
}

function retake() {
  clearResult()
  startCamera()
}

function use() {
  if (!result.value) return
  emit('capture', result.value.file)
  open.value = false
}

function flip() {
  facing.value = facing.value === 'user' ? 'environment' : 'user'
  startCamera()
}

function clearResult() {
  if (result.value) URL.revokeObjectURL(result.value.url)
  result.value = null
}

function stopAll() {
  clearInterval(tick)
  if (recorder) {
    recorder.onstop = null
    if (recorder.state !== 'inactive') recorder.stop()
    recorder = null
  }
  stopStream(stream)
  stream = null
}

watch(open, (isOpen) => {
  if (isOpen) {
    clearResult()
    void startCamera()
  } else {
    stopAll()
    clearResult()
  }
}, { immediate: true })
onBeforeUnmount(() => { stopAll(); clearResult() })

const title = computed(() => (props.mode === 'photo' ? 'Take a photo' : 'Record a video'))
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ content: 'sm:max-w-3xl', body: 'p-0 sm:p-0' }">
    <template #body>
      <input
        ref="fallbackInput"
        type="file"
        class="hidden"
        :accept="mode === 'photo' ? 'image/*' : 'video/*'"
        capture="environment"
        @change="onFallbackPicked"
      />
      <div class="relative flex aspect-[4/3] max-h-[70vh] w-full items-center justify-center overflow-hidden bg-black text-white">
        <video
          v-show="state === 'live' || state === 'recording' || state === 'starting'"
          ref="video"
          autoplay
          muted
          playsinline
          class="size-full object-contain"
          :class="facing === 'user' ? '-scale-x-100' : ''"
        />
        <template v-if="state === 'review' && result">
          <img v-if="mode === 'photo'" :src="result.url" alt="Photo preview" class="size-full object-contain" />
          <video v-else :src="result.url" controls autoplay playsinline class="size-full object-contain" />
        </template>
        <div v-if="state === 'starting'" class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" /> Opening camera…
        </div>
        <div v-if="state === 'error'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <UIcon name="i-lucide-camera-off" class="size-10 text-white/60" />
          <p class="max-w-sm text-sm text-white/80">{{ errorText }}</p>
          <div class="flex gap-2">
            <UButton color="neutral" variant="solid" @click="startCamera">Try again</UButton>
            <UButton color="neutral" variant="outline" class="text-white" @click="fallback">{{ mode === 'photo' ? 'Choose a photo' : 'Choose a video' }}</UButton>
          </div>
        </div>
        <div v-if="flash" class="absolute inset-0 bg-white/80" />
        <div v-if="state === 'recording'" class="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm tabular-nums">
          <span class="size-2 animate-pulse rounded-full bg-red-500" /> {{ formatDuration(elapsed) }} / {{ formatDuration(MAX_VIDEO_SECONDS) }}
        </div>
        <UButton
          v-if="hasMultipleCameras && state === 'live'"
          icon="i-lucide-switch-camera"
          color="neutral"
          variant="solid"
          class="absolute right-3 top-3 rounded-full"
          aria-label="Switch camera"
          @click="flip"
        />
      </div>
      <div class="flex items-center justify-center gap-6 px-4 py-4">
        <template v-if="state === 'review'">
          <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="ghost" @click="retake">Retake</UButton>
          <UButton icon="i-lucide-check" @click="use">{{ mode === 'photo' ? 'Use photo' : 'Use video' }}</UButton>
        </template>
        <template v-else-if="mode === 'photo'">
          <button
            type="button"
            class="size-16 rounded-full border-4 border-primary bg-white shadow transition active:scale-95 disabled:opacity-40"
            :disabled="state !== 'live'"
            aria-label="Take photo"
            @click="takePhoto"
          />
        </template>
        <template v-else>
          <button
            type="button"
            class="flex size-16 items-center justify-center rounded-full border-4 border-white bg-black/80 shadow ring-1 ring-default transition active:scale-95 disabled:opacity-40"
            :disabled="state !== 'live' && state !== 'recording'"
            :aria-label="state === 'recording' ? 'Stop recording' : 'Start recording'"
            @click="state === 'recording' ? stopRecording() : startRecording()"
          >
            <span class="bg-red-500 transition-all" :class="state === 'recording' ? 'size-6 rounded-md' : 'size-11 rounded-full'" />
          </button>
        </template>
      </div>
    </template>
  </UModal>
</template>
