// UTIL-CURRENCIES-001 to UTIL-CURRENCIES-010
import { describe, it, expect } from 'vitest'
import { CURRENCIES, CURRENCY_CODES, CURRENCY_SYMBOLS } from './currencies'

describe('currencies module', () => {
  it('UTIL-CURRENCIES-001: exports at least 162 currencies', () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(162)
  })

  it('UTIL-CURRENCIES-002: CURRENCY_CODES length matches CURRENCIES', () => {
    expect(CURRENCY_CODES.length).toBe(CURRENCIES.length)
  })

  it('UTIL-CURRENCIES-003: NOK is pinned first', () => {
    expect(CURRENCY_CODES[0]).toBe('NOK')
  })

  it('UTIL-CURRENCIES-004: EUR is pinned second', () => {
    expect(CURRENCY_CODES[1]).toBe('EUR')
  })

  it('UTIL-CURRENCIES-005: USD is pinned third', () => {
    expect(CURRENCY_CODES[2]).toBe('USD')
  })

  it('UTIL-CURRENCIES-006: GBP is pinned fourth', () => {
    expect(CURRENCY_CODES[3]).toBe('GBP')
  })

  it('UTIL-CURRENCIES-007: no duplicate currency codes', () => {
    const codes = CURRENCY_CODES
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })

  it('UTIL-CURRENCIES-008: every entry has a non-empty code and symbol', () => {
    for (const entry of CURRENCIES) {
      expect(entry.code.length).toBeGreaterThan(0)
      expect(entry.symbol.length).toBeGreaterThan(0)
    }
  })

  it('UTIL-CURRENCIES-009: CURRENCY_SYMBOLS contains all codes from CURRENCY_CODES', () => {
    for (const code of CURRENCY_CODES) {
      expect(CURRENCY_SYMBOLS).toHaveProperty(code)
      expect(typeof CURRENCY_SYMBOLS[code]).toBe('string')
      expect(CURRENCY_SYMBOLS[code].length).toBeGreaterThan(0)
    }
  })

  it('UTIL-CURRENCIES-010: all previously available BudgetPanel currencies are present', () => {
    const legacyCurrencies = [
      'EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CZK', 'PLN', 'SEK', 'NOK', 'DKK',
      'TRY', 'THB', 'AUD', 'CAD', 'NZD', 'BRL', 'MXN', 'INR', 'IDR', 'MYR',
      'PHP', 'SGD', 'KRW', 'CNY', 'HKD', 'TWD', 'ZAR', 'AED', 'SAR', 'ILS',
      'EGP', 'MAD', 'HUF', 'RON', 'BGN', 'HRK', 'ISK', 'RUB', 'UAH', 'BDT',
      'LKR', 'VND', 'CLP', 'COP', 'PEN', 'ARS',
    ]
    for (const code of legacyCurrencies) {
      expect(CURRENCY_CODES).toContain(code)
    }
  })
})
