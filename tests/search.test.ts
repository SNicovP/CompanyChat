import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let owner: string
let alice: string // client manager
let bob: string // client member
let carol: string // outsider
let site: string
let secret: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}
const post = (user: string, channel: string, body: string) =>
  asUser(db, user, () => db.query(`insert into messages (channel_id, body) values ($1, $2)`, [channel, body]))
const search = (user: string, q: string, lim?: number) =>
  asUser(db, user, async () =>
    (await db.query<{ body: string }>(`select body from search_messages($1, $2)`, [q, lim ?? 30])).rows.map((r) => r.body),
  )

beforeEach(async () => {
  db = await createDb()
  owner = await addUser(db, 'owner')
  alice = await addUser(db, 'alice')
  bob = await addUser(db, 'bob')
  carol = await addUser(db, 'carol')
  const acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'member')`, [acme, alice, bob])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  secret = await one(`insert into channels (kind, client_id, name, is_private) values ('project', $1, 'budget', true) returning id`, [acme])
})

describe('search_messages', () => {
  it('finds whole words and word prefixes, case-insensitively', async () => {
    await post(alice, site, 'Deploy the Responder build tonight')
    expect(await search(bob, 'responder')).toEqual(['Deploy the Responder build tonight'])
    expect(await search(bob, 'RESP')).toEqual(['Deploy the Responder build tonight'])
    expect(await search(bob, 'nothing')).toEqual([])
  })

  it('requires every word to match, in any order', async () => {
    await post(alice, site, 'invoice for the website')
    await post(alice, site, 'website is down')
    expect(await search(bob, 'website invoice')).toEqual(['invoice for the website'])
  })

  it('returns newest first and respects the limit', async () => {
    await post(alice, site, 'report one')
    await post(alice, site, 'report two')
    await post(alice, site, 'report three')
    // Back-to-back inserts can share a clock tick; make the order explicit.
    await db.query(`update messages set created_at = now() - interval '3 minutes' where body = 'report one'`)
    await db.query(`update messages set created_at = now() - interval '2 minutes' where body = 'report two'`)
    await db.query(`update messages set created_at = now() - interval '1 minute' where body = 'report three'`)
    expect(await search(bob, 'report')).toEqual(['report three', 'report two', 'report one'])
    expect(await search(bob, 'report', 2)).toEqual(['report three', 'report two'])
  })

  it('never returns messages from channels the caller cannot open', async () => {
    await post(owner, secret, 'salary numbers')
    await post(alice, site, 'salary review is public')
    expect(await search(bob, 'salary')).toEqual(['salary review is public']) // bob is not in the private channel
    expect(await search(carol, 'salary')).toEqual([]) // outsider
    expect(await search(owner, 'salary')).toHaveLength(2)
  })

  it('does not expose DMs to other people', async () => {
    const dm = await asUser(db, alice, async () => (await db.query<{ get_or_create_dm: string }>(`select get_or_create_dm($1)`, [bob])).rows[0]!.get_or_create_dm)
    await post(alice, dm, 'private lunch plans')
    expect(await search(bob, 'lunch')).toEqual(['private lunch plans'])
    expect(await search(carol, 'lunch')).toEqual([])
    expect(await search(owner, 'lunch')).toEqual([])
  })

  it('does not match mention ids, and punctuation in the query is harmless', async () => {
    await post(alice, site, `hey @[${bob}] ping`)
    expect(await search(alice, bob.slice(0, 8))).toEqual([])
    expect(await search(alice, 'ping')).toHaveLength(1)
    expect(await search(alice, `'; drop table messages; -- & | ! (`)).toEqual([])
    expect(await search(alice, '   ')).toEqual([])
    expect(await search(alice, 'foo-bar:*')).toEqual([])
  })

  it('finds text after an edit', async () => {
    await post(alice, site, 'old wording')
    await asUser(db, alice, () => db.query(`update messages set body = 'new wording'`))
    expect(await search(bob, 'old')).toEqual([])
    expect(await search(bob, 'new')).toEqual(['new wording'])
  })
})
