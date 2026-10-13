import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

// ---------- componentes ----------

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="tv-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={wide ? 'tv-modal wide' : 'tv-modal'} role="dialog" aria-modal="true">
        <header className="tv-modal-head">
          <h2>{title}</h2>
          <button className="tv-icon-btn" type="button" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="tv-modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Logo({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const initials = name
    .replace(/^[A-Z]{2,3}\s*[:|]\s*/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <span className="tv-logo" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span>{initials || '?'}</span>
      )}
    </span>
  )
}

/** Lista virtualizada de altura fixa por linha (listas IPTV passam de 10 mil itens). */
export function VirtualList<T>({
  items,
  rowHeight,
  render,
  className,
  scrollToIndex,
  onRangeChange,
}: {
  items: T[]
  rowHeight: number
  render: (item: T, index: number) => ReactNode
  className?: string
  scrollToIndex?: number
  onRangeChange?: (start: number, end: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element || scrollToIndex == null || scrollToIndex < 0) return
    const top = scrollToIndex * rowHeight
    if (top < element.scrollTop || top + rowHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2)
    }
  }, [scrollToIndex, rowHeight])

  const overscan = 6
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan)

  useEffect(() => {
    onRangeChange?.(start, end)
  }, [start, end, onRangeChange])

  return (
    <div ref={ref} className={`tv-virtual ${className ?? ''}`} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {items.slice(start, end).map((item, offset) => (
          <div key={start + offset} style={{ position: 'absolute', top: (start + offset) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {render(item, start + offset)}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="tv-empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  )
}
