<script setup lang="ts">
// Sound settings: a tone per kind of message, the incoming-call ringtone, volume, and your own uploaded sounds.
// Tones and uploaded sounds are saved to the account (they follow you to other devices); the message-sound switch
// and the volume are per device.
import {
  DEFAULT_TONES, RINGTONE_OPTIONS, TONE_CATEGORIES, TONE_OPTIONS, customIdOf, customRef, resolveTones,
  type ToneCategory, type ToneRef, type Tones,
} from '~/utils/tones'
import { MAX_SOUNDS, SOUND_ACCEPT } from '~/composables/useCustomSounds'

const open = defineModel<boolean>('open', { required: true })
const notifier = useNotifier()
const profile = useProfileStore()
const custom = useCustomSounds()
const toast = useToast()

watch(open, (v) => { if (!v) notifier.stopPreviewing() })

function saveToAccount(tones: Tones | null) {
  profile.saveTones(tones).catch((e) =>
    toast.add({ title: 'Could not save your tones to your account', description: `${errorMessage(e)} They still apply on this device.`, color: 'warning' }),
  )
}

const volume = computed({
  get: () => Math.round(notifier.prefs.value.volume * 100),
  set: (v: number) => notifier.set('volume', v / 100),
})

/** Built-in choices first, then your uploaded sounds under their own heading. */
function optionsFor(category: ToneCategory) {
  const builtin = category === 'call' ? RINGTONE_OPTIONS : TONE_OPTIONS
  if (!custom.sounds.value.length) return builtin
  return [builtin, [{ type: 'label' as const, label: 'Your sounds' }, ...custom.sounds.value.map((s) => ({ value: customRef(s.id), label: s.name }))]]
}

const tone = (category: ToneCategory) => notifier.prefs.value.tones[category]

function choose(category: ToneCategory, ref: ToneRef) {
  notifier.setTone(category, ref)
  notifier.preview(ref, category)
  saveToAccount(notifier.prefs.value.tones)
}

function reset() {
  notifier.set('tones', { ...DEFAULT_TONES })
  notifier.set('volume', 0.8)
  saveToAccount(null)
}

// --- your sounds
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const deleting = ref<string | null>(null)

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // picking the same file again should work
  if (!file) return
  uploading.value = true
  try {
    const sound = await custom.upload(file)
    toast.add({ title: `"${sound.name}" added`, description: 'Pick it for any kind of message or for incoming calls.' })
  } catch (err) {
    toast.add({ title: 'Sound not added', description: errorMessage(err), color: 'error' })
  } finally {
    uploading.value = false
  }
}

async function remove(id: string, name: string) {
  deleting.value = id
  try {
    const saved = await custom.remove(id)
    // Whatever used it is back to its default, on the account and here.
    const tones = resolveTones(saved)
    for (const c of Object.keys(tones) as ToneCategory[]) if (customIdOf(notifier.prefs.value.tones[c]) === id) notifier.setTone(c, tones[c])
    toast.add({ title: `"${name}" deleted` })
  } catch (err) {
    toast.add({ title: 'Could not delete the sound', description: errorMessage(err), color: 'error' })
  } finally {
    deleting.value = null
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Sound settings" description="Choose what you hear for messages and calls. Tones and your sounds are saved to your account; volume is for this device.">
    <template #body>
      <div class="space-y-6">
        <section class="space-y-4">
          <USwitch
            :model-value="notifier.prefs.value.sound"
            label="Play message sounds"
            @update:model-value="(v: boolean) => notifier.set('sound', v)"
          />
          <div class="space-y-4" :class="{ 'pointer-events-none opacity-50': !notifier.prefs.value.sound }">
            <div v-for="c in TONE_CATEGORIES" :key="c.value" class="flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-highlighted">{{ c.label }}</div>
                <div class="text-xs text-muted">{{ c.description }}</div>
              </div>
              <USelect
                :model-value="tone(c.value)"
                :items="optionsFor(c.value)"
                class="w-40"
                :aria-label="`Tone for ${c.label}`"
                @update:model-value="(v: ToneRef) => choose(c.value, v)"
              />
              <UButton
                icon="i-lucide-play"
                color="neutral"
                variant="ghost"
                :disabled="tone(c.value) === 'none'"
                :aria-label="`Play the ${c.label} tone`"
                @click="notifier.preview(tone(c.value), c.value)"
              />
            </div>
          </div>
        </section>

        <section class="flex items-center gap-3 border-t border-default pt-4">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-highlighted">Incoming calls</div>
            <div class="text-xs text-muted">Rings until you answer or decline</div>
          </div>
          <USelect
            :model-value="tone('call')"
            :items="optionsFor('call')"
            class="w-40"
            aria-label="Ringtone for incoming calls"
            @update:model-value="(v: ToneRef) => choose('call', v)"
          />
          <UButton
            icon="i-lucide-play"
            color="neutral"
            variant="ghost"
            :disabled="tone('call') === 'none'"
            aria-label="Play the ringtone"
            @click="notifier.preview(tone('call'), 'call')"
          />
        </section>

        <UFormField label="Volume">
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-volume-1" class="size-4 text-muted" />
            <USlider v-model="volume" :min="0" :max="100" :step="5" class="flex-1" @pointerup="notifier.preview(tone('dm'), 'dm')" />
            <span class="w-10 text-right text-xs text-muted tabular-nums">{{ volume }}%</span>
          </div>
        </UFormField>

        <section class="space-y-3 border-t border-default pt-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-medium text-highlighted">Your sounds</div>
              <div class="text-xs text-muted">MP3, WAV, OGG or M4A, up to 1 MB and 30 seconds</div>
            </div>
            <UButton
              icon="i-lucide-upload"
              size="sm"
              color="neutral"
              variant="outline"
              :loading="uploading"
              :disabled="custom.sounds.value.length >= MAX_SOUNDS"
              @click="fileInput?.click()"
            >Upload</UButton>
            <input ref="fileInput" type="file" :accept="SOUND_ACCEPT" class="hidden" @change="onFile">
          </div>
          <p v-if="!custom.sounds.value.length" class="text-xs text-muted">
            Upload a sound to use it as a message tone or ringtone.
          </p>
          <ul v-else class="divide-y divide-default rounded-md border border-default">
            <li v-for="s in custom.sounds.value" :key="s.id" class="flex items-center gap-2 py-1 pl-3 pr-1">
              <UIcon name="i-lucide-music" class="size-4 shrink-0 text-muted" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ s.name }}</span>
              <UButton icon="i-lucide-play" size="sm" color="neutral" variant="ghost" :aria-label="`Play ${s.name}`" @click="notifier.preview(customRef(s.id), 'dm')" />
              <UButton
                icon="i-lucide-trash-2"
                size="sm"
                color="error"
                variant="ghost"
                :loading="deleting === s.id"
                :aria-label="`Delete ${s.name}`"
                @click="remove(s.id, s.name)"
              />
            </li>
          </ul>
          <p v-if="custom.sounds.value.length >= MAX_SOUNDS" class="text-xs text-muted">You have {{ MAX_SOUNDS }} sounds, the most you can keep. Delete one to add another.</p>
        </section>

        <p class="text-xs text-muted">
          When CompanyChat is closed, background notifications and calls use your device's own sounds.
        </p>

        <div class="flex justify-between gap-2">
          <UButton color="neutral" variant="ghost" @click="reset">Reset to defaults</UButton>
          <UButton @click="open = false">Done</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
