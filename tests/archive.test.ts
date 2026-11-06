import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let owner: string
let alice: string // client manager
let bob: string // client member
let acme: string
let site: string

async function one(sql: string, params: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
}
const visibleProjects = (user: string) =>
  asUser(db, user, async () => (await db.query<{ id: string }>('select id from channels where kind = $1', ['project'])).rows.map((r) => r.id))
const visibleClients = (user: string) =>
  asUser(db, user, async () => (await db.query<{ id: string }>('select id from clients')).rows.map((r) => r.id))
const messageCount = (user: string) => asUser(db, user, async () => (await db.query('select 1 from messages')).rows.length)

beforeEach(async () => {
  db = await createDb()
  owner = await addUser(db, 'owner')
  alice = await addUser(db, 'alice')
  bob = await addUser(db, 'bob')
  acme = await one(`insert into clients (name) values ('Acme') returning id`)
  await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'member')`, [acme, alice, bob])
  site = await one(`insert into channels (kind, client_id, name) values ('project', $1, 'website') returning id`, [acme])
  await db.query(`insert into messages (channel_id, user_id, body) values ($1, $2, 'hello')`, [site, bob])
})

describe('archiving projects', () => {
  it('hides an archived project and its messages from members, keeps it for managers to restore', async () => {
    await asUser(db, alice, () => db.query('select set_channel_archived($1, true)', [site]))
    expect(await visibleProjects(bob)).toEqual([])
    expect(await messageCount(bob)).toBe(0)
    expect(await messageCount(alice)).toBe(0) // frozen for everyone
    expect(await visibleProjects(alice)).toEqual([site]) // listed so it can be restored

    await asUser(db, alice, () => db.query('select set_channel_archived($1, false)', [site]))
    expect(await visibleProjects(bob)).toEqual([site])
    expect(await messageCount(bob)).toBe(1)
  })

  it('lets only managers archive', async () => {
    await expect(asUser(db, bob, () => db.query('select set_channel_archived($1, true)', [site]))).rejects.toThrow(/not allowed/)
  })

  it('blocks posting and hard deleting', async () => {
    await asUser(db, alice, () => db.query('select set_channel_archived($1, true)', [site]))
    await asUser(db, bob, async () => {
      await expect(db.query(`insert into messages (channel_id, body) values ($1, 'x')`, [site])).rejects.toThrow(/row-level security/)
    })
    await asUser(db, alice, async () => {
      await expect(db.query('delete from channels where id = $1', [site])).rejects.toThrow(/permission denied/)
    })
  })
})

describe('archiving clients', () => {
  it('lets only admins archive a client, and hides it and its projects from members', async () => {
    await expect(asUser(db, alice, () => db.query('select set_client_archived($1, true)', [acme]))).rejects.toThrow(/only admins/)
    await asUser(db, owner, () => db.query('select set_client_archived($1, true)', [acme]))
    expect(await visibleClients(bob)).toEqual([])
    expect(await visibleProjects(bob)).toEqual([])
    expect(await messageCount(bob)).toBe(0)
    expect(await visibleClients(owner)).toEqual([acme])

    await asUser(db, owner, () => db.query('select set_client_archived($1, false)', [acme]))
    expect(await visibleClients(bob)).toEqual([acme])
    expect(await visibleProjects(bob)).toEqual([site])
    expect(await messageCount(bob)).toBe(1)
  })
})
