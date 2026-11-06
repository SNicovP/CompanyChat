import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let admin: string
let member: string
let viewer: string
let outsider: string
let acme: string
let site: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}
const post = (user: string, channel: string, body: string) =>
  asUser(db, user, () => db.query('insert into messages (channel_id, body) values ($1, $2)', [channel, body]))

beforeEach(async () => {
  db = await createDb()
  await addUser(db, 'super') // first user: super_admin
  admin = await addUser(db, 'admin')
  member = await addUser(db, 'member')
  viewer = await addUser(db, 'viewer')
  outsider = await addUser(db, 'outsider')
  await db.query(`update profiles set app_role = 'admin' where id = $1`, [admin])
  await db.query(`update profiles set app_role = 'viewer' where id = $1`, [viewer])
  acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id) values ($1, $2), ($1, $3)`, [acme, member, viewer])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
})

describe('member and viewer roles', () => {
  it('lets members and admins post in projects they can see', async () => {
    await post(member, site, 'hello')
    await post(admin, site, 'hi')
  })

  it('lets a viewer read a project they were added to, but not post, edit or attach there', async () => {
    await post(member, site, 'read me')
    const seen = await asUser(db, viewer, async () => (await db.query('select body from messages')).rows)
    expect(seen).toEqual([{ body: 'read me' }])
    await expect(post(viewer, site, 'can I?')).rejects.toThrow(/row-level security/)
  })

  it('only shows a viewer the clients and projects they were added to', async () => {
    const other = await one(`insert into clients (name) values ('Globex') returning id`)
    await db.query(`insert into channels (kind, client_id, name) values ('project', $1, 'secret')`, [other])
    const clients = await asUser(db, viewer, async () => (await db.query<{ id: string }>('select id from clients')).rows.map((r) => r.id))
    expect(clients).toEqual([acme])
    const channels = await asUser(db, viewer, async () => (await db.query<{ id: string }>('select id from channels')).rows.map((r) => r.id))
    expect(channels).toEqual([site])
  })

  it('lets a viewer use direct messages both ways, including with other viewers', async () => {
    const dm = await asUser(db, viewer, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [member])).rows[0]!.id)
    await post(viewer, dm, 'what did you mean in the website chat?')
    await post(member, dm, 'about the logo')
    const seen = await asUser(db, viewer, async () => (await db.query('select body from messages where channel_id = $1', [dm])).rows)
    expect(seen).toHaveLength(2)
    const dm2 = await asUser(db, viewer, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [outsider])).rows[0]!.id)
    await post(viewer, dm2, 'hi')
  })

  it('stops members and viewers creating or changing clients and projects', async () => {
    for (const user of [member, viewer]) {
      await asUser(db, user, async () => {
        await expect(db.query(`insert into clients (name) values ('Nope')`)).rejects.toThrow(/row-level security/)
        await expect(db.query(`insert into channels (kind, client_id, name) values ('project', $1, 'x')`, [acme])).rejects.toThrow(/row-level security/)
        expect((await db.query(`update clients set name = 'x' where id = $1`, [acme])).affectedRows).toBe(0)
        await expect(db.query('select set_channel_archived($1, true)', [site])).rejects.toThrow(/not allowed/)
      })
    }
  })

  it('applies a role change straight away', async () => {
    await expect(post(viewer, site, 'no')).rejects.toThrow(/row-level security/)
    await db.query(`update profiles set app_role = 'member' where id = $1`, [viewer])
    await post(viewer, site, 'now I can')
  })
})
