// FE-CLIENT-001 to FE-CLIENT-007
import { describe, it, expect } from 'vitest'
import { isAuthPublicPath } from './client'

describe('isAuthPublicPath', () => {
  it('FE-CLIENT-001: returns true for root path "/"', () => {
    expect(isAuthPublicPath('/')).toBe(true)
  })

  it('FE-CLIENT-002: returns true for /login', () => {
    expect(isAuthPublicPath('/login')).toBe(true)
  })

  it('FE-CLIENT-003: returns true for /register', () => {
    expect(isAuthPublicPath('/register')).toBe(true)
  })

  it('FE-CLIENT-004: returns true for /forgot-password', () => {
    expect(isAuthPublicPath('/forgot-password')).toBe(true)
  })

  it('FE-CLIENT-005: returns true for /reset-password', () => {
    expect(isAuthPublicPath('/reset-password')).toBe(true)
  })

  it('FE-CLIENT-006: returns true for paths under /shared/', () => {
    expect(isAuthPublicPath('/shared/abc123')).toBe(true)
    expect(isAuthPublicPath('/shared/')).toBe(true)
  })

  it('FE-CLIENT-007: returns false for authenticated routes', () => {
    expect(isAuthPublicPath('/dashboard')).toBe(false)
    expect(isAuthPublicPath('/trips')).toBe(false)
    expect(isAuthPublicPath('/profile')).toBe(false)
    expect(isAuthPublicPath('')).toBe(false)
  })
})
