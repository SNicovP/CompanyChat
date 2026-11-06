import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createDb } from './helpers/db'

let db: PGlite
let owner: string
let admin: string
let alice: string // client manager
let bob: string // plain client member
let carol: string // not in any client

async function ids(userId: string, sql: string, params: unknown[] = []) {
  return asUser(db, userId, async () => (await db.query<{ id: string }>(sql, params)).rows.map((r) => r.id))
}

async function createClient(name: string) {
  const { rows } = await db.query<{ id: string }>('insert into clients (name) values ($1) returning id', [name])
  return rows[0]!.id
}

async function createProject(clientId: string, name: string, isPrivate = false) {
  const { rows } = await db.query<{ id: string }>(
    `insert into channels (kind, client_id, name, is_private) values ('project', $1, $2, $3) returning id`,
    [clientId, name, isPrivate],
  )
  return rows[0]!.id
}

beforeEach(async () => {
  db = await createDb()
  owner = await addUser(db, 'owner')
  admin = await addUser(db, 'admin')
  alice = await addUser(db, 'alice')
  bob = await addUser(db, 'bob')
  carol = await addUser(db, 'carol')
  await db.query(`update profiles set app_role = 'admin' where id = $1`, [admin])
})

describe('profiles and app roles', () => {
  it('makes the first user the owner and everyone after a member', async () => {
    const { rows } = await db.query<{ id: string; app_role: string }>('select id, app_role from profiles')
    const role = (id: string) => rows.find((r) => r.id === id)!.app_role
    expect(role(owner)).toBe('owner')
    expect(role(alice)).toBe('member')
  })

  it('stops users changing their own role but allows their status', async () => {
    await asUser(db, bob, async () => {
      await expect(db.query(`update profiles set app_role = 'admin' where id = $1`, [bob])).rejects.toThrow(/permission denied/)
      await db.query(`update profiles set status = 'away' where id = $1`, [bob])
    })
    const { rows } = await db.query<{ status: string }>('select status from profiles where id = $1', [bob])
    expect(rows[0]!.status).toBe('away')
  })

  it('stops users editing other profiles', async () => {
    const res = await asUser(db, bob, () => db.query(`update profiles set display_name = 'x' where id = $1`, [alice]))
    expect(res.affectedRows).toBe(0)
  })

  it('lets only the owner change roles, and never to owner', async () => {
    await asUser(db, owner, () => db.query('select set_app_role($1, $2)', [bob, 'admin']))
    const { rows } = await db.query<{ app_role: string }>('select app_role from profiles where id = $1', [bob])
    expect(rows[0]!.app_role).toBe('admin')

    await asUser(db, admin, async () => {
      await expect(db.query('select set_app_role($1, $2)', [carol, 'admin'])).rejects.toThrow(/only the owner/)
    })
    await asUser(db, owner, async () => {
      await expect(db.query('select set_app_role($1, $2)', [carol, 'owner'])).rejects.toThrow(/not supported/)
    })
  })
})

describe('clients and client membership', () => {
  it('lets admins create clients but not plain members', async () => {
    await asUser(db, admin, () => db.query(`insert into clients (name) values ('Acme')`))
    await asUser(db, bob, async () => {
      await expect(db.query(`insert into clients (name) values ('Nope')`)).rejects.toThrow(/row-level security/)
    })
  })

  it('shows a client only to its members and to admins', async () => {
    const acme = await createClient('Acme')
    await db.query(`insert into client_members (client_id, user_id) values ($1, $2)`, [acme, bob])

    expect(await ids(bob, 'select id from clients')).toEqual([acme])
    expect(await ids(carol, 'select id from clients')).toEqual([])
    expect(await ids(admin, 'select id from clients')).toEqual([acme])
  })

  it('lets a client manager add and remove members of their own client only', async () => {
    const acme = await createClient('Acme')
    const globex = await createClient('Globex')
    await db.query(`insert into client_members (client_id, user_id, role) values ($1, $2, 'manager')`, [acme, alice])

    await asUser(db, alice, async () => {
      await db.query(`insert into client_members (client_id, user_id) values ($1, $2)`, [acme, bob])
      await expect(
        db.query(`insert into client_members (client_id, user_id) values ($1, $2)`, [globex, bob]),
      ).rejects.toThrow(/row-level security/)
      const del = await db.query(`delete from client_members where client_id = $1 and user_id = $2`, [acme, bob])
      expect(del.affectedRows).toBe(1)
    })
  })

  it('stops plain members managing membership', async () => {
    const acme = await createClient('Acme')
    await db.query(`insert into client_members (client_id, user_id) values ($1, $2), ($1, $3)`, [acme, bob, alice])
    await asUser(db, bob, async () => {
      await expect(
        db.query(`insert into client_members (client_id, user_id) values ($1, $2)`, [acme, carol]),
      ).rejects.toThrow(/row-level security/)
      const del = await db.query(`delete from client_members where client_id = $1 and user_id = $2`, [acme, alice])
      expect(del.affectedRows).toBe(0)
      const promote = await db.query(`update client_members set role = 'manager' where user_id = $1`, [bob])
      expect(promote.affectedRows).toBe(0)
    })
  })
})

describe('project channels', () => {
  let acme: string
  let globex: string

  beforeEach(async () => {
    acme = await createClient('Acme')
    globex = await createClient('Globex')
    await db.query(
      `insert into client_members (client_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'member')`,
      [acme, alice, bob],
    )
  })

  it('lets client managers and admins create projects, but not plain members', async () => {
    const insert = `insert into channels (kind, client_id, name) values ('project', $1, $2)`
    await asUser(db, alice, () => db.query(insert, [acme, 'website']))
    await asUser(db, admin, () => db.query(insert, [globex, 'app']))
    await asUser(db, bob, async () => {
      await expect(db.query(insert, [acme, 'sneaky'])).rejects.toThrow(/row-level security/)
    })
    await asUser(db, alice, async () => {
      await expect(db.query(insert, [globex, 'other-client'])).rejects.toThrow(/row-level security/)
    })
  })

  it('lets managers and admins read back the project they just created (insert ... returning)', async () => {
    const insert = `insert into channels (kind, client_id, name, is_private) values ('project', $1, $2, $3) returning id`
    await asUser(db, alice, async () => {
      expect((await db.query(insert, [acme, 'returned', false])).rows).toHaveLength(1)
      expect((await db.query(insert, [acme, 'returned-private', true])).rows).toHaveLength(1)
    })
    await asUser(db, admin, async () => {
      expect((await db.query(insert, [globex, 'admin-returned', false])).rows).toHaveLength(1)
    })
  })

  it('shows public projects to all client members but not to outsiders', async () => {
    const site = await createProject(acme, 'website')
    expect(await ids(bob, 'select id from channels')).toEqual([site])
    expect(await ids(carol, 'select id from channels')).toEqual([])
  })

  it('hides private projects from client members who are not in the channel', async () => {
    const secret = await createProject(acme, 'budget', true)
    expect(await ids(bob, 'select id from channels')).toEqual([])
    expect(await ids(alice, 'select id from channels')).toEqual([secret]) // client manager
    expect(await ids(admin, 'select id from channels')).toEqual([secret])

    await db.query(`insert into channel_members (channel_id, user_id) values ($1, $2)`, [secret, bob])
    expect(await ids(bob, 'select id from channels')).toEqual([secret])
  })

  it('lets client managers manage channel members, and plain members not', async () => {
    const site = await createProject(acme, 'website')
    await asUser(db, alice, () =>
      db.query(`insert into channel_members (channel_id, user_id) values ($1, $2)`, [site, bob]),
    )
    await asUser(db, bob, async () => {
      await expect(
        db.query(`insert into channel_members (channel_id, user_id) values ($1, $2)`, [site, carol]),
      ).rejects.toThrow(/row-level security/)
    })
  })

  it('stops members renaming or deleting projects', async () => {
    const site = await createProject(acme, 'website')
    await asUser(db, bob, async () => {
      expect((await db.query(`update channels set name = 'x' where id = $1`, [site])).affectedRows).toBe(0)
      await expect(db.query(`delete from channels where id = $1`, [site])).rejects.toThrow(/permission denied/)
    })
    await asUser(db, alice, async () => {
      expect((await db.query(`update channels set name = 'site' where id = $1`, [site])).affectedRows).toBe(1)
    })
  })

  it('does not let a project be moved to another client', async () => {
    const site = await createProject(acme, 'website')
    await asUser(db, alice, async () => {
      await expect(db.query(`update channels set client_id = $1 where id = $2`, [globex, site])).rejects.toThrow(/permission denied/)
    })
  })

  it('rejects duplicate project names within a client', async () => {
    await createProject(acme, 'website')
    await expect(createProject(acme, 'Website')).rejects.toThrow(/duplicate key/)
    await createProject(globex, 'website')
  })
})

describe('direct messages', () => {
  it('creates one DM per pair and reuses it in either direction', async () => {
    const first = await asUser(db, alice, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [bob])).rows[0]!.id)
    const again = await asUser(db, bob, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [alice])).rows[0]!.id)
    expect(again).toBe(first)
  })

  it('keeps DMs private, even from admins and the owner', async () => {
    const dm = await asUser(db, alice, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [bob])).rows[0]!.id)
    expect(await ids(alice, 'select id from channels')).toEqual([dm])
    expect(await ids(bob, 'select id from channels')).toEqual([dm])
    expect(await ids(carol, 'select id from channels')).toEqual([])
    expect(await ids(admin, 'select id from channels')).toEqual([])
    expect(await ids(owner, 'select id from channels')).toEqual([])
  })

  it('cannot be created directly, nor have members added', async () => {
    const dm = await asUser(db, alice, async () => (await db.query<{ id: string }>('select get_or_create_dm($1) as id', [bob])).rows[0]!.id)
    await asUser(db, alice, async () => {
      await expect(db.query(`insert into channels (kind, is_private) values ('dm', true)`)).rejects.toThrow(/row-level security/)
      await expect(
        db.query(`insert into channel_members (channel_id, user_id) values ($1, $2)`, [dm, carol]),
      ).rejects.toThrow(/row-level security/)
    })
  })

  it('refuses a DM with yourself or an unknown user', async () => {
    await asUser(db, alice, async () => {
      await expect(db.query('select get_or_create_dm($1)', [alice])).rejects.toThrow(/yourself/)
      await expect(db.query('select get_or_create_dm($1)', ['00000000-0000-4000-8000-ffffffffffff'])).rejects.toThrow(/unknown user/)
    })
  })
})

describe('deactivated users', () => {
  it('see and change nothing, even with a still-valid session, until reactivated', async () => {
    const acme = await createClient('Acme')
    await db.query(`insert into client_members (client_id, user_id) values ($1, $2)`, [acme, bob])
    const site = await createProject(acme, 'website')
    await asUser(db, bob, () => db.query(`insert into messages (channel_id, body) values ($1, 'before')`, [site]))

    await db.query(`update profiles set is_active = false where id = $1`, [bob])
    await asUser(db, bob, async () => {
      expect((await db.query('select id from clients')).rows).toHaveLength(0)
      expect((await db.query('select id from channels')).rows).toHaveLength(0)
      expect((await db.query('select id from messages')).rows).toHaveLength(0)
      expect((await db.query('select id from profiles')).rows).toHaveLength(0)
      await expect(db.query(`insert into messages (channel_id, body) values ($1, 'after')`, [site])).rejects.toThrow(/row-level security/)
      await expect(db.query('select get_or_create_dm($1)', [alice])).rejects.toThrow(/deactivated/)
    })

    // others cannot DM a deactivated user, and active users are unaffected
    await asUser(db, alice, async () => {
      await expect(db.query('select get_or_create_dm($1)', [bob])).rejects.toThrow(/unknown user/)
    })

    await db.query(`update profiles set is_active = true where id = $1`, [bob])
    await asUser(db, bob, async () => {
      expect((await db.query('select id from messages')).rows).toHaveLength(1)
    })
  })

  it('cannot reactivate themselves', async () => {
    await db.query(`update profiles set is_active = false where id = $1`, [bob])
    await asUser(db, bob, async () => {
      await expect(db.query(`update profiles set is_active = true where id = $1`, [bob])).rejects.toThrow(/permission denied/)
    })
  })
})

describe('service_role (admin-users Edge Function)', () => {
  it('can read and flag profiles, which needs explicit grants', async () => {
    await db.exec('set role service_role')
    try {
      const { rows } = await db.query<{ is_active: boolean }>('select is_active from profiles where id = $1', [bob])
      expect(rows[0]!.is_active).toBe(true)
      await db.query('update profiles set is_active = false where id = $1', [bob])
    } finally {
      await db.exec('reset role')
    }
    const { rows } = await db.query<{ is_active: boolean }>('select is_active from profiles where id = $1', [bob])
    expect(rows[0]!.is_active).toBe(false)
  })
})
