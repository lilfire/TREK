import { render, screen } from '@testing-library/react'
import TripCover, { coverSrc, COVER_ASPECT } from './TripCover'

describe('coverSrc', () => {
  it('keeps absolute paths and URLs as-is', () => {
    expect(coverSrc('/uploads/covers/a.jpg')).toBe('/uploads/covers/a.jpg')
    expect(coverSrc('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
    expect(coverSrc('blob:http://localhost/abc')).toBe('blob:http://localhost/abc')
    expect(coverSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
  })

  it('prefixes bare relative paths with /uploads/', () => {
    expect(coverSrc('covers/a.jpg')).toBe('/uploads/covers/a.jpg')
  })
})

describe('TripCover', () => {
  it('renders the image in the shared banner ratio', () => {
    const { container } = render(<TripCover src="covers/a.jpg" data-testid="cover" />)
    expect(screen.getByTestId('cover')).toHaveAttribute('src', '/uploads/covers/a.jpg')
    expect((container.firstChild as HTMLElement).style.aspectRatio).toBe(COVER_ASPECT)
  })

  it('shows the fallback background and no image without a cover', () => {
    const { container } = render(<TripCover src={null} fallback="red" />)
    expect(container.querySelector('img')).toBeNull()
    expect((container.firstChild as HTMLElement).style.background).toBe('red')
  })
})
