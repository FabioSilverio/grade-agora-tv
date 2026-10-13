import { useEffect, useState, useSyncExternalStore } from 'react'
import { HttpError, maybeGunzip, smartFetch } from './net'
import { getPlaylistData, xtreamClient } from './playlists'
import { getPlaylist, netConfig } from './state'
import { idb } from './storage'
import type { PlaylistConfig, Programme } from './types'
import { normalizeName, parseXmltvStream, type XmltvIndex } from './xmltv'

export const EPG_PRESETS = [
  { label: 'Grade Agora BR (canais brasileiros, atualizada todo dia)', url: '/epg/br-priority.xml' },
]

type ChannelKey = { epgId?: string; streamId?: number; name: string }

const XMLTV_TTL = 12 * 60 * 60 * 1000
const XTREAM_TTL = 3 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

// ---------- status observavel (para a UI) ----------

export type EpgStatus = { state: 'idle' | 'loading' | 'ready' | 'error'; message?: string }
const statuses = new Map<string, EpgStatus>()
const statusListeners = new Set<() => void>()
function setStatus(playlistId: string, status: EpgStatus) {
  statuses.set(playlistId, status)
  statusListeners.forEach((listener) => listener())
}
export function useEpgStatus(playlistId: string | null) {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    () => (playlistId ? statuses.get(playlistId) : undefined) ?? IDLE,
  )
}
const IDLE: EpgStatus = { state: 'idle' }

// ---------- XMLTV ----------

type StoredIndex = { at: number; source: string; index: XmltvIndex }
const xmltvMemory = new Map<string, StoredIndex>()
const xmltvInflight = new Map<string, Promise<StoredIndex | null>>()

function xmltvSources(config: PlaylistConfig, epgUrls: string[]) {
  if (config.epgMode === 'custom') return config.customEpgUrl ? [config.customEpgUrl] : []
  if (config.epgMode === 'provider-xmltv') return epgUrls
  return []
}

async function loadXmltv(config: PlaylistConfig, force = false): Promise<StoredIndex | null> {
  const data = await getPlaylistData(config)
  const sources = xmltvSources(config, data.epgUrls)
  if (!sources.length) {
    setStatus(config.id, { state: 'error', message: 'Nenhuma URL de EPG configurada para esta playlist.' })
    return null
  }
  const sourceKey = sources.join(' ')

  if (!force) {
    const mem = xmltvMemory.get(config.id)
    if (mem && mem.source === sourceKey && Date.now() - mem.at < XMLTV_TTL) return mem
    const stored = await idb.get<StoredIndex>(`xmltv:${config.id}`).catch(() => undefined)
    if (stored && stored.source === sourceKey && Date.now() - stored.at < XMLTV_TTL) {
      xmltvMemory.set(config.id, stored)
      setStatus(config.id, { state: 'ready', message: describe(stored) })
      return stored
    }
  }

  const running = xmltvInflight.get(config.id)
  if (running) return running

  const promise = (async () => {
    setStatus(config.id, { state: 'loading', message: 'Baixando guia (EPG)...' })
    const wantedIds = new Set<string>()
    const wantedNames = new Set<string>()
    for (const channel of data.channels) {
      if (channel.epgId) wantedIds.add(channel.epgId.toLowerCase())
      const name = normalizeName(channel.name)
      if (name) wantedNames.add(name)
    }

    const merged: XmltvIndex = { programmes: {}, names: {} }
    const errors: string[] = []
    for (const source of sources) {
      try {
        const { response } = await smartFetch(source, netConfig())
        if (!response.ok || !response.body) throw new HttpError(response.status, `HTTP ${response.status}`)
        const stream = await maybeGunzip(response.body)
        const index = await parseXmltvStream(stream, {
          wantedIds,
          wantedNames,
          from: Date.now() - 12 * HOUR,
          to: Date.now() + 8 * 24 * HOUR,
          onProgress: (count) =>
            setStatus(config.id, { state: 'loading', message: `Lendo guia... ${count.toLocaleString('pt-BR')} programas` }),
        })
        for (const [id, list] of Object.entries(index.programmes)) merged.programmes[id] ??= list
        for (const [name, id] of Object.entries(index.names)) merged.names[name] ??= id
      } catch (error) {
        errors.push(`${source}: ${error instanceof Error ? error.message : error}`)
      }
    }

    if (!Object.keys(merged.programmes).length && errors.length) {
      setStatus(config.id, { state: 'error', message: `Falha ao carregar EPG. ${errors[0]}` })
      return null
    }
    const stored: StoredIndex = { at: Date.now(), source: sourceKey, index: merged }
    xmltvMemory.set(config.id, stored)
    await idb.set(`xmltv:${config.id}`, stored).catch(() => undefined)
    setStatus(config.id, { state: 'ready', message: describe(stored) })
    epgVersion += 1
    versionListeners.forEach((listener) => listener())
    return stored
  })().finally(() => xmltvInflight.delete(config.id))

  xmltvInflight.set(config.id, promise)
  return promise
}

function describe(stored: StoredIndex) {
  const channels = Object.keys(stored.index.programmes).length
  const time = new Date(stored.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `Guia com ${channels} canais (atualizado ${time}).`
}

function lookupXmltv(stored: StoredIndex, channel: ChannelKey) {
  const { programmes, names } = stored.index
  if (channel.epgId) {
    const byId = programmes[channel.epgId.toLowerCase()]
    if (byId) return byId
  }
  const byName = names[normalizeName(channel.name)]
  return byName ? (programmes[byName] ?? []) : []
}

// ---------- Xtream API (por canal) ----------

type StoredChannelEpg = { at: number; list: Programme[] }
const xtreamMemory = new Map<string, StoredChannelEpg>()
const xtreamInflight = new Map<string, Promise<Programme[]>>()
let active = 0
const queue: Array<() => void> = []

function limited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const runTask = () => {
      active += 1
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1
          queue.shift()?.()
        })
    }
    if (active < 4) runTask()
    else queue.push(runTask)
  })
}

async function loadXtreamChannel(config: PlaylistConfig, streamId: number, force = false): Promise<Programme[]> {
  const key = `${config.id}:${streamId}`
  if (!force) {
    const mem = xtreamMemory.get(key)
    if (mem && Date.now() - mem.at < XTREAM_TTL) return mem.list
    const stored = await idb.get<StoredChannelEpg>(`epgx:${key}`).catch(() => undefined)
    if (stored && Date.now() - stored.at < XTREAM_TTL) {
      xtreamMemory.set(key, stored)
      return stored.list
    }
  }
  const running = xtreamInflight.get(key)
  if (running) return running
  const client = xtreamClient(config)
  if (!client) return []
  const promise = limited(() => client.channelEpg(streamId))
    .then(async (list) => {
      const entry = { at: Date.now(), list }
      xtreamMemory.set(key, entry)
      await idb.set(`epgx:${key}`, entry).catch(() => undefined)
      return list
    })
    .finally(() => xtreamInflight.delete(key))
  xtreamInflight.set(key, promise)
  return promise
}

// ---------- API publica ----------

let epgVersion = 0
const versionListeners = new Set<() => void>()
/** Muda quando um novo guia XMLTV termina de carregar (para recarregar componentes). */
export function useEpgVersion() {
  return useSyncExternalStore(
    (listener) => {
      versionListeners.add(listener)
      return () => versionListeners.delete(listener)
    },
    () => epgVersion,
  )
}

export async function getProgrammes(playlistId: string, channel: ChannelKey, options: { force?: boolean } = {}) {
  const config = getPlaylist(playlistId)
  if (!config || config.epgMode === 'none') return []

  let list: Programme[]
  if (config.epgMode === 'xtream-api') {
    if (config.kind !== 'xtream' || !channel.streamId) return []
    list = await loadXtreamChannel(config, channel.streamId, options.force)
  } else {
    const stored = await loadXmltv(config, options.force)
    if (!stored) return []
    list = lookupXmltv(stored, channel)
  }

  const shift = (config.epgShiftHours ?? 0) * HOUR
  return shift ? list.map((item) => ({ ...item, start: item.start + shift, stop: item.stop + shift })) : list
}

export function reloadEpg(playlistId: string) {
  const config = getPlaylist(playlistId)
  if (!config) return
  for (const key of [...xtreamMemory.keys()]) if (key.startsWith(`${playlistId}:`)) xtreamMemory.delete(key)
  if (config.epgMode === 'provider-xmltv' || config.epgMode === 'custom') {
    xmltvMemory.delete(playlistId)
    void loadXmltv(config, true)
  } else {
    epgVersion += 1
    versionListeners.forEach((listener) => listener())
  }
}

/** Pre-carrega a XMLTV da playlist ativa para o guia aparecer rapido. */
export function warmEpg(playlistId: string) {
  const config = getPlaylist(playlistId)
  if (config && (config.epgMode === 'provider-xmltv' || config.epgMode === 'custom')) void loadXmltv(config)
}

export function useProgrammes(playlistId: string | null, channel: ChannelKey | null) {
  const version = useEpgVersion()
  const [state, setState] = useState<{ key: string; list: Programme[]; loading: boolean }>({ key: '', list: [], loading: false })
  const key = playlistId && channel ? `${playlistId}|${channel.streamId ?? ''}|${channel.epgId ?? ''}|${channel.name}|${version}` : ''

  useEffect(() => {
    if (!playlistId || !channel || !key) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) => (current.key === key ? current : { key, list: [], loading: true }))
    getProgrammes(playlistId, channel)
      .then((list) => !cancelled && setState({ key, list, loading: false }))
      .catch(() => !cancelled && setState({ key, list: [], loading: false }))
    return () => {
      cancelled = true
    }
    // channel e derivado de key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state.key === key ? state : { key, list: [] as Programme[], loading: Boolean(key) }
}

export function currentProgramme(list: Programme[], at = Date.now()) {
  return list.find((item) => item.start <= at && item.stop > at)
}
