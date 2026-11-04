import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let admin: string
let alice: string // client manager
let bob: string // client member
let carol: string // outsider
let acme: string
let site: string
let secret: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}

const post = (user: string, channel: string, body: string) =>
  asUser(db, user, () => db.query(`insert into messages (channel_id, body) values ($1, $2)`, [channel, body]))

const readBodies = (user: string, channel: string) =>
  asUser(db, user, async () => (await db.query<{ body: string }>(`select body from messages where channel_id = $1 order by created_at, id`, [channel])).rows.map((r) => r.body))

beforeEach(async () => {
  db = await createDb()
  await addUser(db, 'owner')
  admin = await addUser(db, 'admin')
  alice = await addUser(db, 'alice')
  bob = await addUser(db, 'bob')
  carol = await addUser(db, 'carol')
  await db.query(`update profiles set app_role = 'admin' where id = $1`, [admin])
  acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'member')`, [acme, alice, bob])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  secret = await one(`insert into channels (kind, client_id, name, is_private) values ('project', $1, 'budget', true) returning id`, [acme])
})

describe('messages', () => {
  it('lets client members post and read in a project, and stamps the author', async () => {
    await post(bob, site, 'hello team')
    expect(await readBodies(alice, site)).toEqual(['hello team'])
    const { rows } = await db.query<{ user_id: string }>('select user_id from messages')
    expect(rows[0]!.user_id).toBe(bob)
  })

  it('returns the new message to its author (insert ... returning)', async () => {
    const rows = await asUser(db, bob, async () =>
      (await db.query(`insert into messages (channel_id, body) values ($1, 'hi') returning id, body`, [site])).rows,
    )
    expect(rows).toHaveLength(1)
  })

  it('stops outsiders reading or posting', async () => {
    await post(bob, site, 'internal')
    expect(await readBodies(carol, site)).toEqual([])
    await expect(post(carol, site, 'let me in')).rejects.toThrow(/row-level security/)
  })

  it('keeps private-channel messages to channel members, managers and admins', async () => {
    await db.query(`insert into channel_members (channel_id, user_id) values ($1, $2)`, [secret, bob])
    await post(bob, secret, 'budget is 10k')
    expect(await readBodies(bob, secret)).toEqual(['budget is 10k'])
    expect(await readBodies(admin, secret)).toEqual(['budget is 10k'])
    expect(await readBodies(carol, secret)).toEqual([])
    // a client member who is not in the private channel cannot post there either
    await db.query(`delete from channel_members where channel_id = $1`, [secret])
    await expect(post(bob, secret, 'still here?')).rejects.toThrow(/row-level security/)
  })

  it('does not allow posting as someone else', async () => {
    await asUser(db, bob, async () => {
      await expect(
        db.query(`insert into messages (channel_id, user_id, body) values ($1, $2, 'fake')`, [site, alice]),
      ).rejects.toThrow(/permission denied/)
    })
  })

  it('rejects empty and oversized messages', async () => {
    await expect(post(bob, site, '   ')).rejects.toThrow(/check constraint/)
    await expect(post(bob, site, 'x'.repeat(4001))).rejects.toThrow(/check constraint/)
  })

  it('lets authors edit their own messages (stamping edited_at) but nobody else', async () => {
    await post(bob, site, 'typo')
    await asUser(db, bob, async () => {
      expect((await db.query(`update messages set body = 'fixed'`)).affectedRows).toBe(1)
    })
    await asUser(db, alice, async () => {
      expect((await db.query(`update messages set body = 'hijack'`)).affectedRows).toBe(0)
    })
    const { rows } = await db.query<{ body: string; edited_at: string | null }>('select body, edited_at from messages')
    expect(rows[0]!.body).toBe('fixed')
    expect(rows[0]!.edited_at).not.toBeNull()
  })

  it('lets authors and project managers delete, but not other members', async () => {
    await post(bob, site, 'one')
    await post(alice, site, 'two')
    await asUser(db, bob, async () => {
      expect((await db.query(`delete from messages where body = 'two'`)).affectedRows).toBe(0)
      expect((await db.query(`delete from messages where body = 'one'`)).affectedRows).toBe(1)
    })
    await asUser(db, alice, async () => {
      await db.query(`insert into messages (channel_id, body) values ($1, 'three')`, [site])
    })
    await post(bob, site, 'four')
    await asUser(db, alice, async () => {
      expect((await db.query(`delete from messages where body = 'four'`)).affectedRows).toBe(1) // moderation
    })
  })

  it('keeps DM messages between the two participants only', async () => {
    const dm = await asUser(db, alice, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [bob])).rows[0]!.id)
    await post(alice, dm, 'psst')
    expect(await readBodies(bob, dm)).toEqual(['psst'])
    expect(await readBodies(admin, dm)).toEqual([])
    expect(await readBodies(carol, dm)).toEqual([])
    await expect(post(carol, dm, 'eavesdrop')).rejects.toThrow(/row-level security/)
  })
})
