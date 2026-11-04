<script setup lang="ts">
import type { MembershipRole } from '~/composables/useMembers'

const props = defineProps<{ kind: MemberKind; id: string; canManage: boolean }>()

const chat = useChatStore()
const toast = useToast()
const idRef = toRef(props, 'id')
const { members, loading, load, add, setRole, remove } = useMembers(props.kind, idRef)

const roleItems: { label: string; value: MembershipRole }[] = [
  { label: 'Manager', value: 'manager' },
  { label: 'Member', value: 'member' },
]

const sorted = computed(() =>
  [...members.value].sort(
    (a, b) => Number(b.role === 'manager') - Number(a.role === 'manager') || chat.userName(a.user_id).localeCompare(chat.userName(b.user_id)),
  ),
)

const candidates = computed(() => {
  const inside = new Set(members.value.map((m) => m.user_id))
  return Object.values(chat.directory)
    .filter((u) => !inside.has(u.id))
    .map((u) => ({ label: u.display_name, value: u.id }))
})

const toAdd = ref<string | undefined>()

async function run(action: () => Promise<void>, failTitle: string) {
  try {
    await action()
  } catch (e) {
    toast.add({ title: failTitle, description: errorMessage(e), color: 'error' })
  }
}

async function addSelected() {
  if (!toAdd.value) return
  const userId = toAdd.value
  await run(() => add(userId), 'Could not add member')
  toAdd.value = undefined
}

watch(() => [props.kind, props.id], () => run(load, 'Could not load members'), { immediate: true })
</script>

<template>
  <div class="space-y-3">
    <p v-if="loading && !members.length" class="text-sm text-muted">Loading…</p>
    <p v-else-if="!members.length" class="text-sm text-muted">No members yet.</p>

    <ul class="divide-y divide-default">
      <li v-for="m in sorted" :key="m.user_id" class="flex items-center justify-between gap-3 py-2">
        <span>{{ chat.userName(m.user_id) }}<span v-if="m.user_id === chat.myId" class="text-muted"> (you)</span></span>
        <div class="flex items-center gap-2">
          <USelect
            v-if="canManage"
            :model-value="m.role"
            :items="roleItems"
            size="sm"
            class="w-32"
            @update:model-value="(r: MembershipRole) => run(() => setRole(m.user_id, r), 'Could not change role')"
          />
          <UBadge v-else color="neutral" variant="subtle" class="capitalize">{{ m.role }}</UBadge>
          <UButton
            v-if="canManage"
            icon="i-lucide-user-minus"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Remove member"
            @click="run(() => remove(m.user_id), 'Could not remove member')"
          />
        </div>
      </li>
    </ul>

    <form v-if="canManage" class="flex items-center gap-2" @submit.prevent="addSelected">
      <USelect v-model="toAdd" :items="candidates" placeholder="Add a person…" class="flex-1" :disabled="!candidates.length" />
      <UButton type="submit" :disabled="!toAdd">Add</UButton>
    </form>
  </div>
</template>
