import { useSyncExternalStore } from 'react'
import type { NetConfig } from './net'
import { loadLocal, saveLocal } from './storage'
import type { PlaylistConfig, RecordingRule, Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  proxyMode: 'auto',
  proxyBase: '/api/proxy',
  userAgent: '',
  preferHls: true,
  hlsQuality: 'best',
  padBeforeMin: 2,
  padAfterMin: 5,
  notifications: true,
  keepAwake: true,
}

export type AppState = {
  settings: Settings
  playlists: PlaylistConfig[]
  activePlaylistId: string | null
  favorites: Record<string, string[]>
  rules: RecordingRule[]
}

const KEY = 'iptv:state:v1'

function initialState(): AppState {
  const saved = loadLocal<Partial<AppState>>(KEY, {})
  return {
    settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    playlists: saved.playlists ?? [],
    activePlaylistId: saved.activePlaylistId ?? saved.playlists?.[0]?.id ?? null,
    favorites: saved.favorites ?? {},
    rules: saved.rules ?? [],
  }
}

let state = initialState()
const listeners = new Set<() => void>()

export const store = {
  get: () => state,
  set(update: Partial<AppState> | ((current: AppState) => Partial<AppState>)) {
    const patch = typeof update === 'function' ? update(state) : update
    state = { ...state, ...patch }
    saveLocal(KEY, state)
    listeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

// Outra aba alterou o estado (ex.: regra criada em outra janela).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return
    state = initialState()
    listeners.forEach((listener) => listener())
  })
}

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()))
}

export function netConfig(settings: Settings = store.get().settings): NetConfig {
  return { mode: settings.proxyMode, base: settings.proxyBase || '/api/proxy', userAgent: settings.userAgent || undefined }
}

export function getPlaylist(id: string | null | undefined) {
  return store.get().playlists.find((playlist) => playlist.id === id)
}
