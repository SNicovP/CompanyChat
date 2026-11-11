import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let alice: string
let bob: string
let outsider: string
let site: string
let other: string
let original: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}

beforeEach(async () => {
  db = await createDb()
  await addUser(db, 'owner')
  alice = await addUser(db, 'alice')
  bob = await addUser(db, 'bob')
  outsider = await addUser(db, 'outsider')
  const acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'member')`, [acme, alice, bob])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  other = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'app') returning id`, [acme])
  original = await one(`insert into messages (channel_id, user_id, body) values ($1, $2, 'hello') returning id`, [site, bob])
})

describe('replying to messages', () => {
  it('lets a member reply to a message in the same channel', async () => {
    const id = await asUser(db, alice, () =>
      one(`insert into messages (channel_id, body, reply_to) values ($1, 'hi back', $2) returning id`, [site, original]),
    )
    const row = (await db.query<{ reply_to: string }>('select reply_to from messages where id = $1', [id])).rows[0]!
    expect(row.reply_to).toBe(original)
  })

  it('rejects a reply that quotes a message from another channel', async () => {
    await expect(
      asUser(db, alice, () => db.query(`insert into messages (channel_id, body, reply_to) values ($1, 'sneaky', $2)`, [other, original])),
    ).rejects.toThrow(/same conversation/)
  })

  it('cannot reply to a message the user cannot see', async () => {
    await expect(
      asUser(db, outsider, () => db.query(`insert into messages (channel_id, body, reply_to) values ($1, 'hi', $2)`, [site, original])),
    ).rejects.toThrow()
  })

  it('does not allow changing reply_to after sending', async () => {
    const id = await asUser(db, alice, () =>
      one(`insert into messages (channel_id, body, reply_to) values ($1, 'hi back', $2) returning id`, [site, original]),
    )
    await expect(asUser(db, alice, () => db.query('update messages set reply_to = null where id = $1', [id]))).rejects.toThrow()
  })

  it('keeps the reply, without its quote, when the original is deleted', async () => {
    const id = await asUser(db, alice, () =>
      one(`insert into messages (channel_id, body, reply_to) values ($1, 'hi back', $2) returning id`, [site, original]),
    )
    await asUser(db, bob, () => db.query('delete from messages where id = $1', [original]))
    const row = (await db.query<{ reply_to: string | null; body: string }>('select reply_to, body from messages where id = $1', [id])).rows[0]!
    expect(row).toEqual({ reply_to: null, body: 'hi back' })
  })
})
