import { parseM3u } from './m3u'
import { HttpError, maybeGunzip, smartFetch } from './net'
import { netConfig, store } from './state'
import { idb } from './storage'
import type { PlaylistConfig, PlaylistData } from './types'
import { XtreamClient } from './xtream'

const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const memory = new Map<string, PlaylistData>()
const inflight = new Map<string, Promise<PlaylistData>>()

export function xtreamClient(config: PlaylistConfig) {
  if (config.kind !== 'xtream') return null
  return new XtreamClient(config, netConfig())
}

export function m3uFileKey(playlistId: string) {
  return `m3ufile:${playlistId}`
}

/** Dados da playlist: memoria -> IndexedDB -> rede. */
export async function getPlaylistData(config: PlaylistConfig, options: { force?: boolean } = {}): Promise<PlaylistData> {
  if (!options.force) {
    const cached = memory.get(config.id)
    if (cached) return cached
    const stored = await idb.get<PlaylistData>(`playlist:${config.id}`).catch(() => undefined)
    if (stored && Date.now() - stored.loadedAt < CACHE_TTL_MS) {
      memory.set(config.id, stored)
      return stored
    }
    if (stored) {
      // Cache velho: usa agora e atualiza em segundo plano.
      memory.set(config.id, stored)
      void refresh(config).catch(() => undefined)
      return stored
    }
  }
  return refresh(config)
}

export function peekPlaylistData(playlistId: string) {
  return memory.get(playlistId)
}

function refresh(config: PlaylistConfig) {
  const running = inflight.get(config.id)
  if (running) return running
  const promise = fetchPlaylist(config)
    .then(async (data) => {
      memory.set(config.id, data)
      await idb.set(`playlist:${config.id}`, data).catch(() => undefined)
      listeners.forEach((listener) => listener(config.id))
      return data
    })
    .finally(() => inflight.delete(config.id))
  inflight.set(config.id, promise)
  return promise
}

const listeners = new Set<(playlistId: string) => void>()
export function onPlaylistUpdated(listener: (playlistId: string) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function fetchPlaylist(config: PlaylistConfig): Promise<PlaylistData> {
  const settings = store.get().settings
  if (config.kind === 'xtream') {
    return new XtreamClient(config, netConfig()).load(config.id, settings.preferHls)
  }

  let text: string | undefined
  if (config.url) {
    const { response } = await smartFetch(config.url, netConfig())
    if (!response.ok || !response.body) throw new HttpError(response.status, `Lista M3U retornou HTTP ${response.status}`)
    const stream = await maybeGunzip(response.body)
    text = await new Response(stream).text()
  } else {
    text = await idb.get<string>(m3uFileKey(config.id))
  }
  if (!text) throw new Error('Lista M3U vazia ou arquivo nao encontrado.')
  if (!text.includes('#EXTINF') && !/^https?:\/\//m.test(text)) {
    throw new Error('O conteudo nao parece uma lista M3U.')
  }

  const parsed = parseM3u(text)
  return {
    playlistId: config.id,
    loadedAt: Date.now(),
    channels: parsed.channels,
    movies: parsed.movies,
    series: [],
    epgUrls: parsed.epgUrls,
  }
}

export async function forgetPlaylist(playlistId: string) {
  memory.delete(playlistId)
  await Promise.all([
    idb.del(`playlist:${playlistId}`),
    idb.del(m3uFileKey(playlistId)),
    idb.del(`xmltv:${playlistId}`),
  ]).catch(() => undefined)
}

/** Ordem de URLs a tentar para um canal ao vivo. */
export function channelCandidates(channel: { url: string; altUrls?: string[] }) {
  const preferHls = store.get().settings.preferHls
  const alts = channel.altUrls ?? []
  const urls = preferHls ? [...alts.filter((url) => /\.m3u8/i.test(url)), channel.url, ...alts] : [channel.url, ...alts]
  return [...new Set(urls)]
}
