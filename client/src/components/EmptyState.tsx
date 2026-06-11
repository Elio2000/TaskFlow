import { Icon } from '../icons'

interface EmptyStateProps {
  icon: string
  text: string
  sub?: string
}

export function EmptyState({ icon, text, sub }: EmptyStateProps) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)' }}>
      <Icon name={icon} size={40} strokeWidth={1.2} style={{ marginBottom: 12, opacity: 0.5 }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{text}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  )
}
