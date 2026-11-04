import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let alice: string
let bob: string
let carol: string
let site: string
let secret: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}
const watch = (user: string, channel: string) =>
  asUser(db, user, () => db.query('insert into channel_watches (channel_id) values ($1)', [channel]))
const watched = (user: string) =>
  asUser(db, user, async () => (await db.query<{ channel_id: string }>('select channel_id from channel_watches')).rows.map((r) => r.channel_id))

beforeEach(async () => {
  db = await createDb()
  await addUser(db, 'owner')
  alice = await addUser(db, 'alice')
  bob = await addUser(db, 'bob')
  carol = await addUser(db, 'carol')
  const acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id) values ($1, $2), ($1, $3)`, [acme, alice, bob])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  secret = await one(`insert into channels (kind, client_id, name, is_private) values ('project', $1, 'budget', true) returning id`, [acme])
})

describe('channel watches', () => {
  it('lets people watch channels they can access, and unwatch', async () => {
    await watch(bob, site)
    expect(await watched(bob)).toEqual([site])
    await asUser(db, bob, () => db.query('delete from channel_watches where channel_id = $1', [site]))
    expect(await watched(bob)).toEqual([])
  })

  it('keeps watches private to their owner', async () => {
    await watch(bob, site)
    expect(await watched(alice)).toEqual([])
  })

  it('stops watching channels you cannot access', async () => {
    await expect(watch(bob, secret)).rejects.toThrow(/row-level security/)
    await expect(watch(carol, site)).rejects.toThrow(/row-level security/)
  })

  it('cannot create a watch for someone else, or delete theirs', async () => {
    await asUser(db, bob, async () => {
      await expect(db.query('insert into channel_watches (user_id, channel_id) values ($1, $2)', [alice, site])).rejects.toThrow(/permission denied/)
    })
    await watch(alice, site)
    await asUser(db, bob, async () => {
      expect((await db.query('delete from channel_watches')).affectedRows).toBe(0)
    })
  })

  it('shuts out deactivated users', async () => {
    await watch(bob, site)
    await db.query(`update profiles set is_active = false where id = $1`, [bob])
    expect(await watched(bob)).toEqual([])
    await expect(watch(bob, site)).rejects.toThrow(/row-level security/)
  })
})
