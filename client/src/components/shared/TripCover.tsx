import React from 'react'

/** Every trip cover is rendered in this banner ratio so the crop is identical everywhere. */
export const COVER_ASPECT = '5 / 1'

/** Normalises a stored cover path (absolute URL, /uploads/... or bare filename) to a usable src. */
export function coverSrc(cover: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(cover) || cover.startsWith('/') ? cover : `/uploads/${cover}`
}

interface TripCoverProps {
  src?: string | null
  /** CSS background shown when there is no cover image. */
  fallback?: string
  className?: string
  style?: React.CSSProperties
  imgClassName?: string
  imgStyle?: React.CSSProperties
  /** Overlay content (badges, buttons, gradients) positioned over the image. */
  children?: React.ReactNode
  'data-testid'?: string
}

export default function TripCover({ src, fallback, className, style, imgClassName, imgStyle, children, 'data-testid': testId }: TripCoverProps): React.ReactElement {
  return (
    <div
      className={className}
      style={{ position: 'relative', overflow: 'hidden', aspectRatio: COVER_ASPECT, background: src ? undefined : fallback, ...style }}
    >
      {src && (
        <img
          src={coverSrc(src)}
          alt=""
          data-testid={testId}
          className={imgClassName}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...imgStyle }}
        />
      )}
      {children}
    </div>
  )
}
