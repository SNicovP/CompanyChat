<script setup lang="ts">
// A compact audio player for voice notes and audio files: play/pause, a seek bar, time and playback speed.
// Only one plays at a time across the app.
const props = defineProps<{ src?: string; voice?: boolean; name?: string; mine?: boolean }>()

const audio = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const current = ref(0)
const duration = ref(0)
const speed = ref(1)
const failed = ref(false)

const nowPlaying = useState<HTMLAudioElement | null>('audio-now-playing', () => null)

// MediaRecorder WebM files have no duration in their header (Chrome reports Infinity): seek far ahead to make the
// browser scan the file, then come back.
let probing = false
function onMetadata() {
  const el = audio.value!
  if (Number.isFinite(el.duration)) {
    duration.value = el.duration
    return
  }
  probing = true
  el.currentTime = 1e101
}
function onTimeUpdate() {
  const el = audio.value!
  if (probing) {
    if (Number.isFinite(el.duration)) {
      probing = false
      duration.value = el.duration
      el.currentTime = 0
    }
    return
  }
  current.value = el.currentTime
  if (Number.isFinite(el.duration)) duration.value = el.duration
}
function onDurationChange() {
  const d = audio.value?.duration
  if (d && Number.isFinite(d)) duration.value = d
}

async function toggle() {
  const el = audio.value
  if (!el || !props.src) return
  if (el.paused) {
    if (nowPlaying.value && nowPlaying.value !== el) nowPlaying.value.pause()
    nowPlaying.value = el
    el.playbackRate = speed.value
    try {
      await el.play()
    } catch {
      failed.value = true
    }
  } else {
    el.pause()
  }
}

function seek(e: Event) {
  const el = audio.value
  if (!el) return
  el.currentTime = Number((e.target as HTMLInputElement).value)
  current.value = el.currentTime
}

function cycleSpeed() {
  speed.value = speed.value === 1 ? 1.5 : speed.value === 1.5 ? 2 : 1
  if (audio.value) audio.value.playbackRate = speed.value
}

function onEnded() {
  playing.value = false
  current.value = 0
  if (audio.value) audio.value.currentTime = 0
}

watch(() => props.src, () => { failed.value = false })
onBeforeUnmount(() => {
  audio.value?.pause()
  if (nowPlaying.value === audio.value) nowPlaying.value = null
})

const progress = computed(() => (duration.value ? (current.value / duration.value) * 100 : 0))
</script>

<template>
  <div class="flex w-72 max-w-full items-center gap-2 rounded-2xl border border-default bg-elevated/60 py-1.5 pl-1.5 pr-3">
    <audio
      ref="audio"
      :src="src"
      preload="metadata"
      class="hidden"
      @loadedmetadata="onMetadata"
      @durationchange="onDurationChange"
      @timeupdate="onTimeUpdate"
      @play="playing = true"
      @pause="playing = false"
      @ended="onEnded"
      @error="failed = !!src"
    />
    <button
      type="button"
      class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-inverted transition hover:brightness-110 disabled:opacity-50"
      :disabled="!src || failed"
      :aria-label="playing ? 'Pause' : voice ? 'Play voice note' : `Play ${name ?? 'audio'}`"
      @click="toggle"
    >
      <UIcon v-if="!src" name="i-lucide-loader-circle" class="size-4 animate-spin" />
      <UIcon v-else :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-4" :class="playing ? '' : 'translate-x-px'" />
    </button>
    <div class="min-w-0 flex-1">
      <p v-if="!voice && name" class="truncate text-xs font-medium text-highlighted">{{ name }}</p>
      <div class="relative flex h-5 items-center">
        <div class="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-accented">
          <div class="h-full rounded-full bg-primary" :style="{ width: `${progress}%` }" />
        </div>
        <input
          type="range"
          min="0"
          :max="duration || 0"
          step="0.01"
          :value="current"
          :disabled="!duration"
          aria-label="Seek"
          class="audio-seek relative w-full cursor-pointer appearance-none bg-transparent"
          @input="seek"
        />
      </div>
      <div class="flex items-center justify-between text-[11px] tabular-nums text-muted">
        <span v-if="failed" class="text-error">Can't play this audio here</span>
        <span v-else>{{ playing || current ? formatDuration(current) : formatDuration(duration) }}</span>
        <span v-if="voice" class="inline-flex items-center gap-1"><UIcon name="i-lucide-mic" class="size-3" />Voice note</span>
      </div>
    </div>
    <button
      v-if="src && !failed"
      type="button"
      class="shrink-0 rounded-full bg-accented px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-toned hover:bg-accented/70"
      :aria-label="`Playback speed ${speed}x`"
      @click="cycleSpeed"
    >{{ speed }}×</button>
  </div>
</template>

<style scoped>
.audio-seek::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: var(--ui-primary);
}
.audio-seek::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 9999px;
  background: var(--ui-primary);
}
.audio-seek:disabled::-webkit-slider-thumb { opacity: 0; }
.audio-seek:disabled::-moz-range-thumb { opacity: 0; }
</style>
