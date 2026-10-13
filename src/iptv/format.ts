import type { Channel, ChannelRef } from './types'

// ---------- formatacao ----------

export function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDay(ts: number) {
  const date = new Date(ts)
  const today = new Date()
  const tomorrow = new Date(Date.now() + 86_400_000)
  if (date.toDateString() === today.toDateString()) return 'Hoje'
  if (date.toDateString() === tomorrow.toDateString()) return 'Amanha'
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export function fmtDateTime(ts: number) {
  return `${fmtDay(ts)} ${fmtTime(ts)}`
}

export function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function fmtDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']

export function toChannelRef(playlistId: string, channel: Channel): ChannelRef {
  return {
    playlistId,
    channelId: channel.id,
    name: channel.name,
    url: channel.url,
    altUrls: channel.altUrls,
    epgId: channel.epgId,
    streamId: channel.streamId,
    logo: channel.logo,
    headers: channel.headers,
  }
}
