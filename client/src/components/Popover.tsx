import { useState, useEffect, useRef, useCallback, ReactNode, CSSProperties } from 'react'
import { createPortal } from 'react-dom'

export function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLElement | null>(null)
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const close = useCallback(() => setOpen(false), [])
  return { open, setOpen, ref, toggle, close }
}

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  width?: number
  align?: 'left' | 'right'
  maxHeight?: CSSProperties['maxHeight']
}

export function Popover({ anchorRef, onClose, children, width, align = 'left', maxHeight }: PopoverProps) {
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)

  useEffect(() => {
    const a = anchorRef.current
    if (!a) return
    const r = a.getBoundingClientRect()
    const w = width || 280
    let left = align === 'right' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    const top = r.bottom + 6
    setPos({ left, top, width: w })
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        !(anchorRef.current && anchorRef.current.contains(e.target as Node))
      ) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])

  // 翻转：超出底部则显示在上方
  useEffect(() => {
    if (!pos || !popRef.current) return
    const h = popRef.current.offsetHeight
    if (pos.top + h > window.innerHeight - 8) {
      const r = anchorRef.current?.getBoundingClientRect()
      if (r) {
        setPos((p) => p ? { ...p, top: Math.max(8, r.top - h - 6) } : p)
      }
    }
  }, [pos && pos.top])

  if (!pos) return null

  return createPortal(
    <div
      ref={popRef}
      className="popover"
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        maxHeight: maxHeight || 'min(480px, 80vh)',
        overflowY: 'auto',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
