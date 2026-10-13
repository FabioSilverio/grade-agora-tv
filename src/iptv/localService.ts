// Conexao com o gravador do PC (server/local). Quando ele esta rodando, e ele quem
// grava os agendamentos — com o site fechado. O site so sincroniza as regras.

import { useSyncExternalStore } from 'react'
import type { LocalPlaylist, LocalRecordRequest, LocalRecordings, LocalStatus, LocalSyncPayload } from './localApi'
import { getPlaylistData } from './playlists'
import { store } from './state'
import type { ChannelRef } from './types'
import { XtreamClient } from './xtream'

export const LOCAL_BASE = 'http://127.0.0.1:8787'
const SEEN_KEY = 'iptv:local-seen'

type LocalState = { available: boolean; checked: boolean; status?: LocalStatus; recordings?: LocalRecordings; error?: string }
let local: LocalState = { available: false, checked: false }
const listeners = new Set<() => void>()
function set(patch: Partial<LocalState>) {
  local = { ...local, ...patch }
  listeners.forEach((listener) => listener())
}

export function useLocalService() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => local,
  )
}

export function isLocalActive() {
  return local.available
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${LOCAL_BASE}/api/local${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Grade-Agora': '1' },
    signal: init.signal ?? AbortSignal.timeout(8000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((body as { error?: string }).error || `HTTP ${response.status}`)
  return body as T
}

/** So procura o gravador se o usuario ja usa o proxy do PC ou ja conectou antes (evita pedir permissao de rede local a todos). */
function shouldProbe() {
  const base = store.get().settings.proxyBase
  return /127\.0\.0\.1|localhost/.test(base) || localStorage.getItem(SEEN_KEY) === '1'
}

export async function checkLocal(force = false) {
  if (!force && !shouldProbe()) {
    set({ checked: true })
    return false
  }
  try {
    const status = await call<LocalStatus>('/status', { signal: AbortSignal.timeout(3000) })
    const becameAvailable = !local.available
    localStorage.setItem(SEEN_KEY, '1')
    set({ available: true, checked: true, status, error: undefined })
    if (becameAvailable) void syncLocal()
    void refreshRecordings()
    return true
  } catch (error) {
    set({ available: false, checked: true, error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

export async function refreshRecordings() {
  if (!local.available) return
  try {
    set({ recordings: await call<LocalRecordings>('/recordings') })
  } catch {
    void checkLocal()
  }
}

async function epgSources(playlistId: string): Promise<string[]> {
  const config = store.get().playlists.find((item) => item.id === playlistId)
  if (!config) return []
  if (config.epgMode === 'custom') return config.customEpgUrl ? [new URL(config.customEpgUrl, location.href).href] : []
  if (config.epgMode !== 'provider-xmltv') return []
  if (config.kind === 'xtream') return [new XtreamClient(config, { mode: 'never', base: '' }).xmltvUrl()]
  const data = await getPlaylistData(config).catch(() => null)
  return (data?.epgUrls ?? []).map((url) => new URL(url, location.href).href)
}

let syncing: Promise<void> | null = null
let syncAgain = false
export async function syncLocal() {
  if (!local.available) return
  if (syncing) {
    syncAgain = true
    return syncing
  }
  syncing = (async () => {
    const { rules, playlists, settings } = store.get()
    const payload: LocalSyncPayload = {
      rules,
      playlists: await Promise.all(
        playlists.map(async (playlist): Promise<LocalPlaylist> => ({ ...playlist, epgSources: await epgSources(playlist.id) })),
      ),
      settings: {
        padBeforeMin: settings.padBeforeMin,
        padAfterMin: settings.padAfterMin,
        hlsQuality: settings.hlsQuality,
        userAgent: settings.userAgent,
      },
    }
    try {
      set({ status: await call<LocalStatus>('/state', { method: 'PUT', body: JSON.stringify(payload) }) })
      void refreshRecordings()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  })().finally(() => {
    syncing = null
    if (syncAgain) {
      syncAgain = false
      void syncLocal()
    }
  })
  return syncing
}

export async function localRecordNow(channel: ChannelRef, title: string, stopAt: number) {
  const body: LocalRecordRequest = { channel, title, stopAt, programStart: Date.now() }
  await call('/record', { method: 'POST', body: JSON.stringify(body) })
  await refreshRecordings()
}

export async function localStop(id: string) {
  await call('/stop', { method: 'POST', body: JSON.stringify({ id }) })
  setTimeout(() => void refreshRecordings(), 1500)
}

export async function localDelete(name: string) {
  await call('/delete', { method: 'POST', body: JSON.stringify({ name }) })
  await refreshRecordings()
}

export async function localOpenFolder() {
  await call('/open-folder', { method: 'POST', body: '{}' })
}

export async function localSetOutputDir(path: string) {
  set({ status: await call<LocalStatus>('/output-dir', { method: 'POST', body: JSON.stringify({ path }) }) })
  await refreshRecordings()
}

export function localFileUrl(name: string) {
  return `${LOCAL_BASE}/api/local/file?name=${encodeURIComponent(name)}`
}

let initialized = false
export function initLocalService() {
  if (initialized) return
  initialized = true
  void checkLocal()
  setInterval(() => void checkLocal(), 20_000)
  setInterval(() => void refreshRecordings(), 4000)

  let timer: ReturnType<typeof setTimeout> | undefined
  let previous = store.get()
  store.subscribe(() => {
    const next = store.get()
    const changed = next.rules !== previous.rules || next.playlists !== previous.playlists || next.settings !== previous.settings
    const proxyChanged = next.settings.proxyBase !== previous.settings.proxyBase
    previous = next
    if (proxyChanged) void checkLocal()
    if (!changed) return
    clearTimeout(timer)
    timer = setTimeout(() => void syncLocal(), 800)
  })
}
