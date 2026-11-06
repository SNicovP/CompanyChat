import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let owner: string
let alice: string // admin
let bob: string // client member
let carol: string // outsider
let dave: string // client member
let site: string
let secret: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}
const post = async (user: string, channel: string, body: string) =>
  asUser(db, user, async () => (await db.query<{ id: string }>(`insert into messages (channel_id, body) values ($1, $2) returning id`, [channel, body])).rows[0]!.id)
const mentioned = async (messageId: string) =>
  (await db.query<{ user_id: string }>('select user_id from message_mentions where message_id = $1', [messageId])).rows.map((r) => r.user_id).sort()
const tag = (id: string) => `@[${id}]`

beforeEach(async () => {
  db = await createDb()
  owner = await addUser(db, 'owner')
  alice = await addUser(db, 'alice')
  await db.query(`update profiles set app_role = 'admin' where id = $1`, [alice])
  bob = await addUser(db, 'bob')
  carol = await addUser(db, 'carol')
  dave = await addUser(db, 'dave')
  const acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'member'), ($1, $3, 'member'), ($1, $4, 'member')`, [acme, alice, bob, dave])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  secret = await one(`insert into channels (kind, client_id, name, is_private) values ('project', $1, 'budget', true) returning id`, [acme])
})

describe('mention parsing', () => {
  it('records mentions of people who can see the channel', async () => {
    const m = await post(alice, site, `hi ${tag(bob)} and ${tag(dave)}`)
    expect(await mentioned(m)).toEqual([bob, dave].sort())
  })

  it('ignores outsiders, unknown ids, the author, and duplicates', async () => {
    const m = await post(alice, site, `${tag(carol)} ${tag('00000000-0000-4000-8000-ffffffffffff')} ${tag(alice)} ${tag(bob)} ${tag(bob)}`)
    expect(await mentioned(m)).toEqual([bob])
  })

  it('does not notify client members who cannot see a private channel', async () => {
    const m = await post(alice, secret, `${tag(bob)} ${tag(owner)}`)
    // bob is a client member but not in the private channel; the owner can see every project
    expect(await mentioned(m)).toEqual([owner])
  })

  it('ignores deactivated users', async () => {
    await db.query(`update profiles set is_active = false where id = $1`, [bob])
    expect(await mentioned(await post(alice, site, tag(bob)))).toEqual([])
  })

  it('follows edits: adds new mentions and drops removed ones', async () => {
    const m = await post(alice, site, tag(bob))
    await asUser(db, alice, () => db.query(`update messages set body = $1 where id = $2`, [`${tag(dave)} instead`, m]))
    expect(await mentioned(m)).toEqual([dave])
  })

  it('caps mentions per message', async () => {
    const extra: string[] = []
    for (let i = 0; i < 25; i++) {
      const u = await addUser(db, `extra${i}`)
      await db.query(`insert into client_members (client_id, user_id) select client_id, $1 from channels where id = $2`, [u, site])
      extra.push(u)
    }
    const m = await post(alice, site, extra.map(tag).join(' '))
    expect((await mentioned(m)).length).toBe(20)
  })
})

describe('mention privacy and counts', () => {
  it('shows people only their own mentions', async () => {
    await post(alice, site, tag(bob))
    const count = (u: string) => asUser(db, u, async () => (await db.query('select * from message_mentions')).rows.length)
    expect(await count(bob)).toBe(1)
    expect(await count(alice)).toBe(0)
    expect(await count(dave)).toBe(0)
  })

  it('counts unread mentions per channel and clears them when the channel is read', async () => {
    const unreadMentions = () =>
      asUser(db, bob, async () => Object.fromEntries((await db.query<{ chan_id: string; mentions: string | number }>('select * from get_unread_mention_counts()')).rows.map((r) => [r.chan_id, Number(r.mentions)])))
    await asUser(db, bob, () => db.query('select * from get_unread_counts()')) // first sight initialises markers
    await post(alice, site, `${tag(bob)} one`)
    await post(alice, site, `${tag(bob)} two`)
    await post(alice, site, 'no mention')
    expect(await unreadMentions()).toEqual({ [site]: 2 })
    await asUser(db, bob, () => db.query('select mark_channel_read($1)', [site]))
    expect(await unreadMentions()).toEqual({})
  })

  it('removes mentions with the message', async () => {
    const m = await post(alice, site, tag(bob))
    await asUser(db, alice, () => db.query('delete from messages where id = $1', [m]))
    expect(await mentioned(m)).toEqual([])
  })

  it('keeps the access rules unchanged after the refactor', async () => {
    const { rows } = await db.query<{ ok: boolean }>(`select can_user_access_channel($1, $2) as ok`, [bob, secret])
    expect(rows[0]!.ok).toBe(false)
    await db.query(`insert into channel_members (channel_id, user_id) values ($1, $2)`, [secret, bob])
    expect((await db.query<{ ok: boolean }>(`select can_user_access_channel($1, $2) as ok`, [bob, secret])).rows[0]!.ok).toBe(true)
    expect((await db.query<{ ok: boolean }>(`select can_user_access_channel($1, $2) as ok`, [alice, secret])).rows[0]!.ok).toBe(true)
    expect((await db.query<{ ok: boolean }>(`select can_user_access_channel($1, $2) as ok`, [carol, site])).rows[0]!.ok).toBe(false)
  })
})

describe('@channel', () => {
  it('mentions everyone who can see the channel except the author', async () => {
    const m = await post(bob, site, 'standup in 5 @[channel]')
    // owner sees every project; alice manages the client; dave is a client member; carol is an outsider
    expect(await mentioned(m)).toEqual([owner, alice, dave].sort())
  })

  it('only reaches people who can see a private channel', async () => {
    const m = await post(alice, secret, '@[channel] budget is approved')
    expect(await mentioned(m)).toEqual([owner])
  })

  it('skips deactivated users and is case-insensitive', async () => {
    await db.query(`update profiles set is_active = false where id = $1`, [dave])
    const m = await post(bob, site, '@[Channel] hello')
    expect(await mentioned(m)).toEqual([owner, alice].sort())
  })

  it('combines with personal mentions and follows edits', async () => {
    const m = await post(alice, site, `hi ${tag(bob)}`)
    expect(await mentioned(m)).toEqual([bob])
    await asUser(db, alice, () => db.query(`update messages set body = $1 where id = $2`, ['@[channel] hi', m]))
    expect(await mentioned(m)).toEqual([owner, bob, dave].sort())
    await asUser(db, alice, () => db.query(`update messages set body = $1 where id = $2`, ['no more', m]))
    expect(await mentioned(m)).toEqual([])
  })

  it('is not triggered by the plain text "@channel"', async () => {
    expect(await mentioned(await post(bob, site, 'talk to @channel later'))).toEqual([])
  })
})
