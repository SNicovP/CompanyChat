<script setup lang="ts">
// A static OpenStreetMap preview with a pin in the middle (no mapping library, no API key).
const props = withDefaults(defineProps<{ lat: number; lng: number; zoom?: number; width?: number; height?: number }>(), { zoom: 15, width: 320, height: 160 })
const tiles = computed(() => tilesAround(props.lat, props.lng, props.zoom, props.width, props.height))
</script>

<template>
  <div class="relative overflow-hidden bg-[#e8e4da] dark:bg-neutral-800" :style="{ width: '100%', maxWidth: `${width}px`, aspectRatio: `${width} / ${height}` }">
    <div class="absolute left-1/2 top-1/2" :style="{ width: `${width}px`, height: `${height}px`, transform: 'translate(-50%, -50%)' }">
      <img
        v-for="t in tiles"
        :key="t.url"
        :src="t.url"
        alt=""
        loading="lazy"
        draggable="false"
        referrerpolicy="strict-origin-when-cross-origin"
        class="absolute size-64 max-w-none select-none dark:brightness-[.8] dark:contrast-[1.1]"
        :style="{ left: `${t.left}px`, top: `${t.top}px` }"
      />
    </div>
    <span class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full drop-shadow-md">
      <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 0C6.7 0 0 6.6 0 14.8 0 25.9 15 40 15 40s15-14.1 15-25.2C30 6.6 23.3 0 15 0z" fill="#ef4444" /><circle cx="15" cy="14.5" r="5.5" fill="#fff" /></svg>
    </span>
    <span class="absolute bottom-0 right-0 bg-white/75 px-1 text-[9px] leading-tight text-neutral-700">{{ OSM_ATTRIBUTION }}</span>
  </div>
</template>
