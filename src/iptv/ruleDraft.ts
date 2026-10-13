import { useSyncExternalStore } from 'react'
import type { ChannelRef, RecordingRule } from './types'

// ---------- abrir o editor de qualquer lugar ----------

export type Draft = Partial<RecordingRule> & { channel?: ChannelRef }
let draft: Draft | null = null
const listeners = new Set<() => void>()
export function openRuleEditor(next: Draft) {
  draft = next
  listeners.forEach((listener) => listener())
}
export function closeRuleEditor() {
  draft = null
  listeners.forEach((listener) => listener())
}
export function useDraft() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => draft,
  )
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** Regra "todo dia no horario dele" a partir de um programa da EPG. */
export function seriesDraftFromProgramme(channel: ChannelRef, programme: { title: string; start: number; stop: number }): Draft {
  const date = new Date(programme.start)
  return {
    kind: 'series',
    channel,
    title: programme.title,
    match: 'contains',
    days: ALL_DAYS,
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    durationMin: Math.max(5, Math.round((programme.stop - programme.start) / 60_000)),
    toleranceMin: 90,
    fallbackToTime: false,
  }
}
