import { render, screen, fireEvent, cleanup } from '../../../tests/helpers/render'
import PublicThemeToggle from './PublicThemeToggle'

const STORAGE_KEY = 'trek-public-theme'

function getDocClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

describe('PublicThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    const meta = document.head.querySelector('meta[name="theme-color"]')
    if (!meta) {
      const m = document.createElement('meta')
      m.setAttribute('name', 'theme-color')
      m.setAttribute('content', '#ffffff')
      document.head.appendChild(m)
    } else {
      meta.setAttribute('content', '#ffffff')
    }
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('FE-PTT-001: renders a button with an aria-label', () => {
    render(<PublicThemeToggle />)
    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toBeTruthy()
  })

  it('FE-PTT-002: defaults to light mode when no localStorage and system is light', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<PublicThemeToggle />)
    expect(getDocClass()).toBe(false)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Switch to dark mode')
  })

  it('FE-PTT-003: defaults to dark mode when no localStorage and system is dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    document.documentElement.classList.add('dark')
    render(<PublicThemeToggle />)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Switch to light mode')
  })

  it('FE-PTT-004: reads dark from localStorage and applies dark class', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<PublicThemeToggle />)
    expect(getDocClass()).toBe(true)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Switch to light mode')
  })

  it('FE-PTT-005: reads light from localStorage and applies light class', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    document.documentElement.classList.add('dark')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<PublicThemeToggle />)
    expect(getDocClass()).toBe(false)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Switch to dark mode')
  })

  it('FE-PTT-006: clicking toggle switches from light to dark and persists in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<PublicThemeToggle />)
    const btn = screen.getByRole('button')
    expect(getDocClass()).toBe(false)

    fireEvent.click(btn)

    expect(getDocClass()).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(btn.getAttribute('aria-label')).toBe('Switch to light mode')
  })

  it('FE-PTT-007: clicking toggle switches from dark to light and persists in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    document.documentElement.classList.add('dark')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<PublicThemeToggle />)
    const btn = screen.getByRole('button')
    expect(getDocClass()).toBe(true)

    fireEvent.click(btn)

    expect(getDocClass()).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark mode')
  })

  it('FE-PTT-008: updates meta theme-color on toggle', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<PublicThemeToggle />)
    const btn = screen.getByRole('button')
    const meta = document.head.querySelector('meta[name="theme-color"]')

    fireEvent.click(btn)
    expect(meta?.getAttribute('content')).toBe('#09090b')

    fireEvent.click(btn)
    expect(meta?.getAttribute('content')).toBe('#ffffff')
  })

  it('FE-PTT-009: button is keyboard focusable (not disabled, has type=button)', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<PublicThemeToggle />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  it('FE-PTT-010: OS preference listener is removed on unmount', () => {
    const removeEventListener = vi.fn()
    const addEventListener = vi.fn()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener,
        removeEventListener,
      }),
    })
    const { unmount } = render(<PublicThemeToggle />)
    unmount()
    expect(removeEventListener).toHaveBeenCalled()
  })
})
