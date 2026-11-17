import { defineStore } from 'pinia'

/**
 * People I blocked and people who blocked me. Blocking stops DMs, 1:1 calls and intercom both ways, and is not
 * private: the other person is told and sees it in the DM. Kept live by block.changed on private-user.{id}.
 */
export const useBlocksStore = defineStore('blocks', () => {
  const api = useApi()
  const toast = useToast()
  const chat = useChatStore()

  const blocked = ref<string[]>([])
  const blockedBy = ref<string[]>([])
  /** whom the "Block?" confirmation is about */
  const confirming = ref<string | null>(null)

  const iBlocked = (userId: string | null | undefined) => !!userId && blocked.value.includes(userId)
  const blocksMe = (userId: string | null | undefined) => !!userId && blockedBy.value.includes(userId)
  const between = (userId: string | null | undefined) => iBlocked(userId) || blocksMe(userId)

  /** Why I can't message or call this person, or null. */
  function reason(userId: string | null | undefined): string | null {
    if (iBlocked(userId)) return `You blocked ${chat.userName(userId ?? null)}.`
    if (blocksMe(userId)) return `${chat.userName(userId ?? null)} has blocked you.`
    return null
  }

  async function load() {
    try {
      const res = await api<{ blocked: string[]; blocked_by: string[] }>('/blocks')
      blocked.value = res.blocked
      blockedBy.value = res.blocked_by
    } catch {
      // the API still enforces blocks
    }
  }

  function onChanged(e: { blocker_id: string; blocked_id: string; blocked: boolean }) {
    const me = chat.myId
    const toggle = (list: string[], id: string) => (e.blocked ? [...new Set([...list, id])] : list.filter((x) => x !== id))
    if (e.blocker_id === me) blocked.value = toggle(blocked.value, e.blocked_id)
    else if (e.blocked_id === me) {
      blockedBy.value = toggle(blockedBy.value, e.blocker_id)
      if (e.blocked) toast.add({ title: `${chat.userName(e.blocker_id)} blocked you`, description: "You can't message or call them.", icon: 'i-lucide-ban' })
    }
  }

  async function block(userId: string) {
    try {
      const res = await api<{ blocked: string[] }>(`/users/${userId}/block`, { method: 'PUT' })
      blocked.value = res.blocked
      toast.add({ title: `${chat.userName(userId)} is blocked`, icon: 'i-lucide-ban' })
    } catch (e) {
      toast.add({ title: 'Could not block', description: errorMessage(e), color: 'error' })
    }
  }

  async function unblock(userId: string) {
    try {
      const res = await api<{ blocked: string[] }>(`/users/${userId}/block`, { method: 'DELETE' })
      blocked.value = res.blocked
      toast.add({ title: `${chat.userName(userId)} is unblocked` })
    } catch (e) {
      toast.add({ title: 'Could not unblock', description: errorMessage(e), color: 'error' })
    }
  }

  function reset() {
    blocked.value = []
    blockedBy.value = []
    confirming.value = null
  }

  return { blocked, blockedBy, confirming, iBlocked, blocksMe, between, reason, load, onChanged, block, unblock, reset }
})
