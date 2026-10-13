// Agendador: a cada batida do worker, calcula as ocorrencias das regras e
// inicia/estende/encerra gravacoes. Precisa da aba aberta (pode ficar em segundo plano).

import { useSyncExternalStore } from 'react'
import { getProgrammes } from './epg'
import { activeRecordings, extendRecording, onRecordingDone, onTick, startRecording } from './recorder'
import { computeOccurrences } from './schedule'
import { store } from './state'
import { loadLocal, saveLocal } from './storage'
import type { Occurrence, Programme, RecordingRule } from './types'

const STARTED_KEY = 'iptv:started:v1'
const EPG_REFRESH_MS = 20 * 60 * 1000
const HOUR = 60 * 60 * 1000

type Started = { recId: string; ruleId: string; start: number; stop: number; at: number }
let started = loadLocal<Record<string, Started>>(STARTED_KEY, {})

type RuleCache = { signature: string; at: number; programmes: Programme[] | null; error?: string }
const ruleCache = new Map<string, RuleCache>()

// Com o app aberto em varias abas, so a "lider" (Web Locks) inicia gravacoes.
let leader = typeof navigator === 'undefined' || !('locks' in navigator)
const leaderListeners = new Set<() => void>()
export function useIsLeader() {
  return useSyncExternalStore(
    (listener) => {
      leaderListeners.add(listener)
      return () => leaderListeners.delete(listener)
    },
    () => leader,
  )
}

let upcoming: Occurrence[] = []
let lastRun = 0
let running = false
const listeners = new Set<() => void>()

export function useUpcoming() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => upcoming,
  )
}

export function ruleError(ruleId: string) {
  return ruleCache.get(ruleId)?.error
}

function signature(rule: RecordingRule) {
  return JSON.stringify([rule.kind, rule.channel.playlistId, rule.channel.channelId, rule.channel.epgId, rule.channel.streamId])
}

async function programmesFor(rule: RecordingRule, force: boolean) {
  if (rule.kind !== 'series' && rule.kind !== 'daily') return null
  const sig = signature(rule)
  const cached = ruleCache.get(rule.id)
  if (!force && cached && cached.signature === sig && Date.now() - cached.at < EPG_REFRESH_MS) return cached.programmes
  try {
    const programmes = await getProgrammes(rule.channel.playlistId, {
      epgId: rule.channel.epgId,
      streamId: rule.channel.streamId,
      name: rule.channel.name,
    })
    ruleCache.set(rule.id, { signature: sig, at: Date.now(), programmes })
    return programmes
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // mantem a EPG anterior se houver
    const programmes = cached?.programmes ?? null
    ruleCache.set(rule.id, { signature: sig, at: Date.now(), programmes, error: message })
    return programmes
  }
}

export async function runScheduler(options: { force?: boolean } = {}) {
  if (running) return
  running = true
  try {
    const now = Date.now()
    const { rules } = store.get()
    const all: Occurrence[] = []

    for (const rule of rules) {
      if (!rule.enabled) continue
      const programmes = await programmesFor(rule, Boolean(options.force))
      all.push(...computeOccurrences(rule, programmes, now - 6 * HOUR, now + 7 * 24 * HOUR))
    }

    const activeIds = new Set(activeRecordings().map((info) => info.id))
    for (const occurrence of all) {
      if (!leader) break
      if (occurrence.start > now || occurrence.stop <= now) continue

      // Ja gravando esta ocorrencia (ou uma sobreposta da mesma regra, se a EPG mudou o horario)?
      const existingKey = Object.keys(started).find((key) => {
        const item = started[key]
        return key === occurrence.key || (item.ruleId === occurrence.ruleId && item.start < occurrence.stop && item.stop > occurrence.start)
      })
      if (existingKey) {
        const item = started[existingKey]
        if (activeIds.has(item.recId) && item.stop !== occurrence.stop) {
          // EPG atrasou/adiantou o fim (ex.: jogo com prorrogacao): ajusta a gravacao.
          extendRecording(item.recId, occurrence.stop)
          item.stop = occurrence.stop
        }
        continue
      }

      const recId = await startRecording({
        channel: occurrence.channel,
        title: occurrence.title,
        stopAt: occurrence.stop,
        occurrenceKey: occurrence.key,
        programStart: occurrence.programStart,
      })
      started[occurrence.key] = { recId, ruleId: occurrence.ruleId, start: occurrence.start, stop: occurrence.stop, at: now }
    }

    // limpeza
    for (const [key, item] of Object.entries(started)) if (item.stop < now - 3 * 24 * HOUR) delete started[key]
    saveLocal(STARTED_KEY, started)
    const expiredOnce = rules.filter((rule) => rule.kind === 'once' && rule.stop && rule.stop + rule.padAfterMin * 60_000 < now - HOUR)
    if (expiredOnce.length) {
      const ids = new Set(expiredOnce.map((rule) => rule.id))
      store.set((state) => ({ rules: state.rules.filter((rule) => !ids.has(rule.id)) }))
    }

    upcoming = all.filter((item) => item.stop > now).sort((a, b) => a.start - b.start)
    lastRun = now
    listeners.forEach((listener) => listener())
  } finally {
    running = false
  }
}

export function isOccurrenceStarted(key: string) {
  return Boolean(started[key])
}

let initialized = false
export function initScheduler() {
  if (initialized) return
  initialized = true
  if (!leader) {
    void navigator.locks.request('grade-agora-gravador', () => {
      leader = true
      leaderListeners.forEach((listener) => listener())
      void runScheduler()
      return new Promise<void>(() => undefined) // segura o lock enquanto a aba existir
    })
  }
  onTick(() => void runScheduler())
  onRecordingDone(() => void runScheduler())
  let previousRules = store.get().rules
  store.subscribe(() => {
    const rules = store.get().rules
    if (rules === previousRules) return
    previousRules = rules
    void runScheduler()
  })
  // Recarrega a pagina? Ocorrencias em andamento recomecam numa nova parte.
  started = Object.fromEntries(Object.entries(started).filter(([, item]) => item.stop < Date.now()))
  void runScheduler()
}

export function schedulerLastRun() {
  return lastRun
}
