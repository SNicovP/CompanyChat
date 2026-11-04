import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let alice: string // client manager
let bob: string // client member
let carol: string // outsider
let site: string
let secret: string
let bobMsg: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}
const upload = (user: string, name: string) =>
  asUser(db, user, () => db.query(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [name]))
const visibleFiles = (user: string) =>
  asUser(db, user, async () => (await db.query<{ name: string }>('select name from storage.objects')).rows.map((r) => r.name))
const attach = (user: string, messageId: string, channelId: string, path: string, size = 100) =>
  asUser(db, user, () =>
    db.query(
      `insert into message_attachments (message_id, channel_id, path, file_name, mime_type, size_bytes) values ($1, $2, $3, 'a.png', 'image/png', $4)`,
      [messageId, channelId, path, size],
    ),
  )

beforeEach(async () => {
  db = await createDb()
  await addUser(db, 'owner')
  alice = await addUser(db, 'alice')
  bob = await addUser(db, 'bob')
  carol = await addUser(db, 'carol')
  const acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'member')`, [acme, alice, bob])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  secret = await one(`insert into channels (kind, client_id, name, is_private) values ('project', $1, 'budget', true) returning id`, [acme])
  bobMsg = await asUser(db, bob, async () => (await db.query<{ id: string }>(`insert into messages (channel_id, body) values ($1, '') returning id`, [site])).rows[0]!.id)
})

describe('attachment files (storage policies)', () => {
  it('lets the message author upload into the message folder and channel members read it', async () => {
    await upload(bob, `${site}/${bobMsg}/logo.png`)
    expect(await visibleFiles(alice)).toEqual([`${site}/${bobMsg}/logo.png`])
    expect(await visibleFiles(carol)).toEqual([])
  })

  it('stops uploads into someone else\'s message folder or another channel', async () => {
    await expect(upload(alice, `${site}/${bobMsg}/x.png`)).rejects.toThrow(/row-level security/)
    await expect(upload(carol, `${site}/${bobMsg}/x.png`)).rejects.toThrow(/row-level security/)
    await expect(upload(bob, `${secret}/${bobMsg}/x.png`)).rejects.toThrow(/row-level security/)
  })

  it('stops uploads to other buckets', async () => {
    await db.query(`insert into storage.buckets (id, name) values ('other', 'other')`)
    await asUser(db, bob, async () => {
      await expect(db.query(`insert into storage.objects (bucket_id, name) values ('other', $1)`, [`${site}/${bobMsg}/x.png`])).rejects.toThrow(/row-level security/)
    })
  })

  it('hides files of private channels from client members who are not in them', async () => {
    const msg = await one(`insert into messages (channel_id, user_id, body) values ($1, $2, '') returning id`, [secret, alice])
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)`, [`${secret}/${msg}/plan.pdf`, alice])
    expect(await visibleFiles(bob)).toEqual([])
    expect(await visibleFiles(alice)).toHaveLength(1)
  })

  it('lets the uploader and a project manager delete, but not other members', async () => {
    await upload(bob, `${site}/${bobMsg}/logo.png`)
    await db.query(`insert into client_members (client_id, user_id) select client_id, $1 from channels where id = $2`, [carol, site])
    await asUser(db, carol, async () => {
      expect((await db.query(`delete from storage.objects`)).affectedRows).toBe(0)
    })
    await asUser(db, alice, async () => {
      expect((await db.query(`delete from storage.objects`)).affectedRows).toBe(1) // moderation
    })
    await upload(bob, `${site}/${bobMsg}/again.png`)
    await asUser(db, bob, async () => {
      expect((await db.query(`delete from storage.objects`)).affectedRows).toBe(1)
    })
  })
})

describe('deleting a single attachment', () => {
  let attachmentId: string

  beforeEach(async () => {
    await attach(bob, bobMsg, site, `${site}/${bobMsg}/a.png`)
    attachmentId = await one('select id from message_attachments')
  })

  const flag = (user: string) =>
    asUser(db, user, () => db.query('update message_attachments set deleted_at = now() where id = $1', [attachmentId]))

  it('lets the author flag it as deleted while the message stays', async () => {
    expect((await flag(bob)).affectedRows).toBe(1)
    const { rows } = await db.query<{ deleted_at: string | null }>('select deleted_at from message_attachments')
    expect(rows[0]!.deleted_at).not.toBeNull()
    expect((await db.query('select id from messages where id = $1', [bobMsg])).rows).toHaveLength(1)
  })

  it('lets a project manager do it, but not other members or outsiders', async () => {
    expect((await flag(alice)).affectedRows).toBe(1)
    await db.query('update message_attachments set deleted_at = null')
    await db.query(`insert into client_members (client_id, user_id) select client_id, $1 from channels where id = $2`, [carol, site])
    expect((await flag(carol)).affectedRows).toBe(0) // plain client member, not the author
    const outsider = await addUser(db, 'dave')
    expect((await flag(outsider)).affectedRows).toBe(0)
  })

  it('cannot be undone or used to change other columns', async () => {
    await flag(bob)
    await asUser(db, bob, async () => {
      await expect(db.query('update message_attachments set deleted_at = null')).rejects.toThrow(/row-level security/)
      await expect(db.query(`update message_attachments set file_name = 'x'`)).rejects.toThrow(/permission denied/)
    })
  })
})

describe('attachment records', () => {
  it('lets the author attach, and channel members read, but not outsiders', async () => {
    await attach(bob, bobMsg, site, `${site}/${bobMsg}/a.png`)
    const read = (u: string) => asUser(db, u, async () => (await db.query('select id from message_attachments')).rows.length)
    expect(await read(alice)).toBe(1)
    expect(await read(carol)).toBe(0)
  })

  it('stops other people attaching to a message that is not theirs', async () => {
    await expect(attach(alice, bobMsg, site, `${site}/${bobMsg}/a.png`)).rejects.toThrow(/row-level security/)
  })

  it('rejects paths outside the message folder and oversized files', async () => {
    await expect(attach(bob, bobMsg, site, `${secret}/${bobMsg}/a.png`)).rejects.toThrow(/check constraint/)
    await expect(attach(bob, bobMsg, site, `${site}/${bobMsg}/big.bin`, 10485761)).rejects.toThrow(/check constraint/)
  })

  it('removes attachment rows when the message is deleted', async () => {
    await attach(bob, bobMsg, site, `${site}/${bobMsg}/a.png`)
    await asUser(db, bob, () => db.query('delete from messages where id = $1', [bobMsg]))
    expect((await db.query('select id from message_attachments')).rows).toHaveLength(0)
  })

  it('shuts out deactivated users', async () => {
    await attach(bob, bobMsg, site, `${site}/${bobMsg}/a.png`)
    await upload(bob, `${site}/${bobMsg}/a.png`)
    await db.query(`update profiles set is_active = false where id = $1`, [alice])
    expect(await asUser(db, alice, async () => (await db.query('select id from message_attachments')).rows.length)).toBe(0)
    expect(await visibleFiles(alice)).toEqual([])
  })
})
