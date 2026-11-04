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
const post = (user: string, channel: string, body: string) =>
  asUser(db, user, () => db.query(`insert into messages (channel_id, body) values ($1, $2)`, [channel, body]))
const unread = (user: string) =>
  asUser(db, user, async () => {
    const { rows } = await db.query<{ chan_id: string; unread: string | number }>('select * from get_unread_counts()')
    return Object.fromEntries(rows.map((r) => [r.chan_id, Number(r.unread)]))
  })
const markRead = (user: string, channel: string) => asUser(db, user, () => db.query('select mark_channel_read($1)', [channel]))

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
  await db.query(`insert into channel_members (channel_id, user_id) values ($1, $2)`, [secret, alice])
})

describe('unread counts', () => {
  it('does not show old history as unread the first time a project is seen', async () => {
    await post(alice, site, 'old news')
    expect(await unread(bob)).toEqual({})
  })

  it('counts new messages from others, not your own', async () => {
    await unread(bob) // first sight initialises the marker
    await unread(alice)
    await post(alice, site, 'one')
    await post(alice, site, 'two')
    await post(bob, site, 'mine')
    expect(await unread(bob)).toEqual({ [site]: 2 })
    expect(await unread(alice)).toEqual({ [site]: 1 })
  })

  it('resets when the channel is marked read, then counts again', async () => {
    await unread(bob)
    await post(alice, site, 'one')
    await markRead(bob, site)
    expect(await unread(bob)).toEqual({})
    await post(alice, site, 'two')
    expect(await unread(bob)).toEqual({ [site]: 1 })
  })

  it('counts a DM from its start and clears it once read', async () => {
    const dm = await asUser(db, alice, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [bob])).rows[0]!.id)
    await post(alice, dm, 'hi')
    expect(await unread(bob)).toEqual({ [dm]: 1 })
    await markRead(bob, dm)
    expect(await unread(bob)).toEqual({})
  })

  it('never reports channels the user cannot access', async () => {
    await unread(bob)
    await post(alice, secret, 'confidential')
    expect(await unread(bob)).toEqual({})
    expect(await unread(carol)).toEqual({})
  })

  it('refuses to mark an inaccessible channel as read', async () => {
    await expect(markRead(bob, secret)).rejects.toThrow(/no access/)
    await expect(markRead(carol, site)).rejects.toThrow(/no access/)
  })

  it('keeps read markers out of direct reach', async () => {
    await markRead(bob, site)
    await asUser(db, bob, async () => {
      await expect(db.query('select * from channel_reads')).rejects.toThrow(/permission denied/)
    })
  })
})
