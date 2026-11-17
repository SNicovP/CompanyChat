import { installAudioUnlock } from '~/utils/audio-unlock'

// Intercom and announcements play without anyone answering; see utils/audio-unlock.ts.
export default defineNuxtPlugin(() => {
  installAudioUnlock()
})
