import { describe, expect, it } from 'vitest'
import { canChangeActive, canInvite, parseInvite } from '../supabase/functions/_shared/policy'

describe('canInvite', () => {
  it('allows owners and admins only', () => {
    expect(canInvite('owner').ok).toBe(true)
    expect(canInvite('admin').ok).toBe(true)
    expect(canInvite('member').ok).toBe(false)
  })
})

describe('canChangeActive', () => {
  const owner = { id: 'o', role: 'owner' as const }
  const admin = { id: 'a', role: 'admin' as const }
  const member = { id: 'm', role: 'member' as const }

  it('lets admins deactivate members but not other admins or the owner', () => {
    expect(canChangeActive(admin, member).ok).toBe(true)
    expect(canChangeActive(admin, { id: 'a2', role: 'admin' }).ok).toBe(false)
    expect(canChangeActive(admin, owner).ok).toBe(false)
  })

  it('lets the owner deactivate admins and members', () => {
    expect(canChangeActive(owner, admin).ok).toBe(true)
    expect(canChangeActive(owner, member).ok).toBe(true)
  })

  it('never lets anyone deactivate themselves or the owner', () => {
    expect(canChangeActive(owner, owner).ok).toBe(false)
    expect(canChangeActive(admin, admin).ok).toBe(false)
  })

  it('stops plain members', () => {
    expect(canChangeActive(member, { id: 'x', role: 'member' }).ok).toBe(false)
  })
})

describe('parseInvite', () => {
  it('normalises the email and defaults the name', () => {
    expect(parseInvite({ email: '  Jane.Doe@Example.com ' })).toEqual({ email: 'jane.doe@example.com', display_name: 'jane.doe' })
  })

  it('keeps a provided name, trimmed and capped', () => {
    expect(parseInvite({ email: 'a@b.co', display_name: '  Jane  ' })).toEqual({ email: 'a@b.co', display_name: 'Jane' })
    const long = parseInvite({ email: 'a@b.co', display_name: 'x'.repeat(200) })
    expect('display_name' in long && long.display_name.length).toBe(80)
  })

  it('rejects bad emails', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.de', 42, undefined]) {
      expect('error' in parseInvite({ email })).toBe(true)
    }
  })
})
