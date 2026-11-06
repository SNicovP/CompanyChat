import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let owner: string
let alice: string // admin
let bob: string // client member
let dave: string // client member
let carol: string // outsider
let site: string
let secret: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}
const post = async (user: string, channel: string, body: string) =>
  asUser(db, user, async () => (await db.query<{ id: string }>(`insert into messages (channel_id, body) values ($1, $2) returning id`, [channel, body])).rows[0]!.id)
const watch = (user: string, channel: string) =>
  asUser(db, user, () => db.query(`insert into channel_watches (channel_id) values ($1)`, [channel]))
// push_targets is server-only: call it as the service role.
async function targets(messageId: string) {
  await db.exec('set role service_role')
  try {
    const rows = (await db.query<{ user_id: string; kind: string }>(`select user_id, kind from push_targets($1)`, [messageId])).rows
    return Object.fromEntries(rows.map((r) => [r.user_id, r.kind]))
  } finally {
    await db.exec('reset role')
  }
}

beforeEach(async () => {
  db = await createDb()
  owner = await addUser(db, 'owner')
  alice = await addUser(db, 'alice')
  await db.query(`update profiles set app_role = 'admin' where id = $1`, [alice])
  bob = await addUser(db, 'bob')
  dave = await addUser(db, 'dave')
  carol = await addUser(db, 'carol')
  const acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'member'), ($1, $4, 'member')`, [acme, alice, bob, dave])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  secret = await one(`insert into channels (kind, client_id, name, is_private) values ('project', $1, 'budget', true) returning id`, [acme])
})

describe('push_targets', () => {
  it('pushes DMs to the other person only', async () => {
    const dm = await asUser(db, alice, async () => (await db.query<{ get_or_create_dm: string }>(`select get_or_create_dm($1)`, [bob])).rows[0]!.get_or_create_dm)
    expect(await targets(await post(alice, dm, 'hi'))).toEqual({ [bob]: 'dm' })
  })

  it('ignores plain project messages unless the person watches the channel', async () => {
    const m = await post(alice, site, 'hello team')
    expect(await targets(m)).toEqual({})
    await watch(bob, site)
    expect(await targets(await post(alice, site, 'again'))).toEqual({ [bob]: 'watch' })
  })

  it('pushes mentions and @channel, and a mention wins over a watch', async () => {
    await watch(bob, site)
    const m = await post(alice, site, `hi @[${bob}] and @[${dave}]`)
    expect(await targets(m)).toEqual({ [bob]: 'mention', [dave]: 'mention' })
    const all = await post(alice, site, '@[channel] stand-up')
    expect(await targets(all)).toEqual({ [owner]: 'mention', [bob]: 'mention', [dave]: 'mention' })
  })

  it('never includes the author', async () => {
    await watch(alice, site)
    expect(await targets(await post(alice, site, `@[channel] @[${alice}]`))).not.toHaveProperty(alice)
  })

  it('skips deactivated users and people on Do not disturb', async () => {
    await db.query(`update profiles set status = 'dnd' where id = $1`, [bob])
    await db.query(`update profiles set is_active = false where id = $1`, [dave])
    expect(await targets(await post(alice, site, '@[channel] hi'))).toEqual({ [owner]: 'mention' })
  })

  it('does not push a watcher who can no longer see the channel', async () => {
    await watch(owner, secret) // the owner can see every project
    // bob's watch is left over from before he was removed from the private channel
    await db.query(`insert into channel_watches (user_id, channel_id) values ($1, $2)`, [bob, secret])
    expect(await targets(await post(alice, secret, 'confidential'))).toEqual({ [owner]: 'watch' })
  })

  it('is not callable by signed-in users', async () => {
    const m = await post(alice, site, 'x')
    await expect(asUser(db, bob, () => db.query(`select * from push_targets($1)`, [m]))).rejects.toThrow()
  })
})

describe('push subscriptions', () => {
  const save = (user: string, endpoint: string, preview = true) =>
    asUser(db, user, () => db.query(`select save_push_subscription($1, 'p', 'a', $2, 'ua')`, [endpoint, preview]))
  const mine = (user: string) => asUser(db, user, async () => (await db.query<{ endpoint: string }>(`select endpoint from push_subscriptions`)).rows.map((r) => r.endpoint))

  it('saves, lists only your own, and moves a browser to the new user', async () => {
    await save(alice, 'https://push.example/1')
    await save(bob, 'https://push.example/2')
    expect(await mine(alice)).toEqual(['https://push.example/1'])
    await save(bob, 'https://push.example/1') // same browser, now signed in as bob
    expect(await mine(alice)).toEqual([])
    expect((await mine(bob)).sort()).toEqual(['https://push.example/1', 'https://push.example/2'])
  })

  it('rejects non-https endpoints and deactivated users', async () => {
    await expect(save(alice, 'http://insecure.example/1')).rejects.toThrow()
    await db.query(`update profiles set is_active = false where id = $1`, [alice])
    await expect(save(alice, 'https://push.example/9')).rejects.toThrow()
  })

  it('lets people delete their own and toggle the preview, nothing else', async () => {
    await save(alice, 'https://push.example/1')
    await asUser(db, alice, () => db.query(`update push_subscriptions set show_preview = false`))
    await expect(asUser(db, alice, () => db.query(`update push_subscriptions set endpoint = 'https://x.example/'`))).rejects.toThrow()
    await expect(asUser(db, alice, () => db.query(`update push_subscriptions set user_id = $1`, [bob]))).rejects.toThrow()
    await asUser(db, alice, () => db.query(`delete from push_subscriptions`))
    expect(await mine(alice)).toEqual([])
  })
})
