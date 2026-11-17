<script setup lang="ts">
// Pick a notification tone per kind of message (DMs, @mentions, channel messages), with a volume and a preview.
// Tones are saved to the account (they follow you to other devices); the on/off switch and volume are per device.
import { DEFAULT_TONES, TONE_CATEGORIES, TONE_OPTIONS, type ToneCategory, type ToneId } from '~/utils/tones'

const open = defineModel<boolean>('open', { required: true })
const notifier = useNotifier()
const profile = useProfileStore()
const toast = useToast()

function saveToAccount(tones: Record<ToneCategory, ToneId> | null) {
  profile.saveTones(tones).catch((e) =>
    toast.add({ title: 'Could not save your tones to your account', description: `${errorMessage(e)} They still apply on this device.`, color: 'warning' }),
  )
}

const volume = computed({
  get: () => Math.round(notifier.prefs.value.volume * 100),
  set: (v: number) => notifier.set('volume', v / 100),
})

function choose(category: ToneCategory, tone: ToneId) {
  notifier.setTone(category, tone)
  notifier.preview(tone)
  saveToAccount(notifier.prefs.value.tones)
}

function reset() {
  notifier.set('tones', { ...DEFAULT_TONES })
  notifier.set('volume', 0.8)
  saveToAccount(null)
}
</script>

<template>
  <UModal v-model:open="open" title="Notification sounds" description="Choose a tone for each kind of message. Your tones are saved to your account; sound on/off and volume are for this device.">
    <template #body>
      <div class="space-y-5">
        <USwitch
          :model-value="notifier.prefs.value.sound"
          label="Play sounds"
          @update:model-value="(v: boolean) => notifier.set('sound', v)"
        />

        <div class="space-y-4" :class="{ 'pointer-events-none opacity-50': !notifier.prefs.value.sound }">
          <div v-for="c in TONE_CATEGORIES" :key="c.value" class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-highlighted">{{ c.label }}</div>
              <div class="text-xs text-muted">{{ c.description }}</div>
            </div>
            <USelect
              :model-value="notifier.prefs.value.tones[c.value]"
              :items="TONE_OPTIONS"
              class="w-40"
              :aria-label="`Tone for ${c.label}`"
              @update:model-value="(v: ToneId) => choose(c.value, v)"
            />
            <UButton
              icon="i-lucide-play"
              color="neutral"
              variant="ghost"
              :disabled="notifier.prefs.value.tones[c.value] === 'none'"
              :aria-label="`Play the ${c.label} tone`"
              @click="notifier.preview(notifier.prefs.value.tones[c.value])"
            />
          </div>

          <UFormField label="Volume">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-volume-1" class="size-4 text-muted" />
              <USlider v-model="volume" :min="0" :max="100" :step="5" class="flex-1" @pointerup="notifier.preview(notifier.prefs.value.tones.dm)" />
              <span class="w-10 text-right text-xs text-muted tabular-nums">{{ volume }}%</span>
            </div>
          </UFormField>
        </div>

        <p class="text-xs text-muted">
          When CompanyChat is closed, background notifications use your device's own notification sound.
        </p>

        <div class="flex justify-between gap-2">
          <UButton color="neutral" variant="ghost" @click="reset">Reset to defaults</UButton>
          <UButton @click="open = false">Done</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
