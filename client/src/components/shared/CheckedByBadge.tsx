interface CheckedByBadgeProps {
  username: string
  avatar?: string | null
  size?: number
}

export default function CheckedByBadge({ username, avatar, size = 17 }: CheckedByBadgeProps) {
  const title = `Checked by ${username}`
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        title={title}
        data-testid="checked-by-badge"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          border: '1.5px solid var(--bg-card)',
          boxSizing: 'border-box',
        }}
      />
    )
  }
  return (
    <span
      title={title}
      data-testid="checked-by-badge"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `hsl(${(username.charCodeAt(0) || 0) * 37 % 360}, 55%, 55%)`,
        color: 'white',
        fontSize: Math.round(size * 0.5),
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        textTransform: 'uppercase',
        border: '1.5px solid var(--bg-card)',
        boxSizing: 'border-box',
      }}
    >
      {username[0] || '?'}
    </span>
  )
}
