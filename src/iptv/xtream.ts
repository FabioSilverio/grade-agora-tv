import { fetchJson, type NetConfig } from './net'
import type { Channel, PlaylistData, Programme, SeriesItem, VodItem } from './types'

type XtreamCreds = { server: string; username: string; password: string }

type Category = { category_id: string; category_name: string }

type LiveStream = {
  num?: number
  name: string
  stream_id: number
  stream_icon?: string
  epg_channel_id?: string | null
  category_id?: string | null
}

type VodStream = {
  name: string
  stream_id: number
  stream_icon?: string
  category_id?: string | null
  container_extension?: string
  rating?: string | number
  year?: string
}

type SeriesStream = {
  name: string
  series_id: number
  cover?: string
  category_id?: string | null
  plot?: string
  rating?: string | number
}

type AuthInfo = {
  user_info?: {
    auth?: number
    status?: string
    exp_date?: string | null
    max_connections?: string
    active_cons?: string
    message?: string
  }
}

export type SeriesInfo = {
  info?: { name?: string; plot?: string; cover?: string; genre?: string; releaseDate?: string }
  episodes?: Record<
    string,
    Array<{
      id: string
      episode_num: number | string
      title: string
      container_extension?: string
      season?: number
      info?: { plot?: string; duration?: string; movie_image?: string }
    }>
  >
}

export function normalizeServer(server: string) {
  let value = server.trim()
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  return value
    .replace(/\/(player_api\.php|get\.php|xmltv\.php).*$/i, '')
    .replace(/\/+$/, '')
}

/** Detecta links get.php?username=..&password=.. e devolve as credenciais Xtream. */
export function credsFromGetPhp(url: string): XtreamCreds | null {
  try {
    const parsed = new URL(url.trim())
    const username = parsed.searchParams.get('username')
    const password = parsed.searchParams.get('password')
    if (!/get\.php$/i.test(parsed.pathname) || !username || !password) return null
    return { server: parsed.origin, username, password }
  } catch {
    return null
  }
}

export class XtreamClient {
  readonly server: string
  readonly username: string
  readonly password: string
  private net: NetConfig

  constructor(creds: XtreamCreds, net: NetConfig) {
    this.server = normalizeServer(creds.server)
    this.username = creds.username.trim()
    this.password = creds.password.trim()
    this.net = net
  }

  private apiUrl(action?: string, params: Record<string, string | number> = {}) {
    const url = new URL(`${this.server}/player_api.php`)
    url.searchParams.set('username', this.username)
    url.searchParams.set('password', this.password)
    if (action) url.searchParams.set('action', action)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    return url.href
  }

  api<T>(action?: string, params?: Record<string, string | number>, signal?: AbortSignal) {
    return fetchJson<T>(this.apiUrl(action, params), this.net, signal)
  }

  liveUrl(streamId: number, ext: 'm3u8' | 'ts') {
    return `${this.server}/live/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${streamId}.${ext}`
  }

  movieUrl(streamId: number, ext = 'mp4') {
    return `${this.server}/movie/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${streamId}.${ext}`
  }

  episodeUrl(episodeId: string, ext = 'mp4') {
    return `${this.server}/series/${encodeURIComponent(this.username)}/${encodeURIComponent(this.password)}/${episodeId}.${ext}`
  }

  xmltvUrl() {
    return `${this.server}/xmltv.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`
  }

  async load(playlistId: string, preferHls: boolean, signal?: AbortSignal): Promise<PlaylistData> {
    const auth = await this.api<AuthInfo>(undefined, undefined, signal)
    if (!auth?.user_info || auth.user_info.auth === 0) {
      throw new Error('Login Xtream recusado. Confira servidor, usuario e senha.')
    }

    const [liveCats, live, vodCats, vod, seriesCats, series] = await Promise.all([
      this.api<Category[]>('get_live_categories', undefined, signal).catch(() => []),
      this.api<LiveStream[]>('get_live_streams', undefined, signal),
      this.api<Category[]>('get_vod_categories', undefined, signal).catch(() => []),
      this.api<VodStream[]>('get_vod_streams', undefined, signal).catch(() => []),
      this.api<Category[]>('get_series_categories', undefined, signal).catch(() => []),
      this.api<SeriesStream[]>('get_series', undefined, signal).catch(() => []),
    ])

    const catName = (cats: Category[]) => {
      const map = new Map((Array.isArray(cats) ? cats : []).map((cat) => [String(cat.category_id), cat.category_name]))
      return (id?: string | null) => map.get(String(id)) ?? 'Sem categoria'
    }
    const liveCat = catName(liveCats)
    const vodCat = catName(vodCats)
    const seriesCat = catName(seriesCats)

    const channels: Channel[] = (Array.isArray(live) ? live : []).map((stream) => {
      const hls = this.liveUrl(stream.stream_id, 'm3u8')
      const ts = this.liveUrl(stream.stream_id, 'ts')
      return {
        id: String(stream.stream_id),
        name: stream.name?.trim() || `Canal ${stream.stream_id}`,
        logo: stream.stream_icon || undefined,
        group: liveCat(stream.category_id),
        url: preferHls ? hls : ts,
        altUrls: [preferHls ? ts : hls],
        epgId: stream.epg_channel_id || undefined,
        streamId: stream.stream_id,
        num: stream.num,
      }
    })

    const movies: VodItem[] = (Array.isArray(vod) ? vod : []).map((stream) => ({
      id: String(stream.stream_id),
      name: stream.name?.trim() || `Filme ${stream.stream_id}`,
      logo: stream.stream_icon || undefined,
      group: vodCat(stream.category_id),
      streamId: stream.stream_id,
      ext: stream.container_extension || 'mp4',
      url: this.movieUrl(stream.stream_id, stream.container_extension || 'mp4'),
      rating: stream.rating ? String(stream.rating) : undefined,
      year: stream.year,
    }))

    const seriesItems: SeriesItem[] = (Array.isArray(series) ? series : []).map((item) => ({
      id: String(item.series_id),
      seriesId: item.series_id,
      name: item.name?.trim() || `Serie ${item.series_id}`,
      cover: item.cover || undefined,
      group: seriesCat(item.category_id),
      plot: item.plot,
      rating: item.rating ? String(item.rating) : undefined,
    }))

    const info = auth.user_info
    return {
      playlistId,
      loadedAt: Date.now(),
      channels,
      movies,
      series: seriesItems,
      epgUrls: [this.xmltvUrl()],
      accountInfo: {
        maxConnections: Number(info.max_connections) || undefined,
        activeConnections: Number(info.active_cons) || 0,
        expiresAt: info.exp_date ? Number(info.exp_date) * 1000 : undefined,
        status: info.status,
      },
    }
  }

  seriesInfo(seriesId: number, signal?: AbortSignal) {
    return this.api<SeriesInfo>('get_series_info', { series_id: seriesId }, signal)
  }

  /** EPG completa do canal (get_simple_data_table), com titulos em base64. */
  async channelEpg(streamId: number, signal?: AbortSignal): Promise<Programme[]> {
    type Listing = {
      title?: string
      description?: string
      start_timestamp?: string | number
      stop_timestamp?: string | number
      start?: string
      end?: string
    }
    const data = await this.api<{ epg_listings?: Listing[] }>('get_simple_data_table', { stream_id: streamId }, signal)
    let listings = data?.epg_listings
    if (!Array.isArray(listings) || !listings.length) {
      const short = await this.api<{ epg_listings?: Listing[] }>('get_short_epg', { stream_id: streamId, limit: 50 }, signal).catch(
        () => null,
      )
      listings = short?.epg_listings
    }
    if (!Array.isArray(listings)) return []

    return listings
      .map((item) => ({
        start: Number(item.start_timestamp) * 1000 || Date.parse(item.start ?? ''),
        stop: Number(item.stop_timestamp) * 1000 || Date.parse(item.end ?? ''),
        title: decodeB64(item.title ?? '') || 'Sem titulo',
        desc: decodeB64(item.description ?? '').slice(0, 400) || undefined,
      }))
      .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.stop) && item.stop > item.start)
      .sort((a, b) => a.start - b.start)
  }
}

function decodeB64(value: string) {
  if (!value) return ''
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value) || value.length % 4 !== 0) return value.trim()
  try {
    const binary = atob(value)
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))).trim()
    // eslint-disable-next-line no-control-regex
    return /[�\u0000-\u0008]/.test(decoded) ? value.trim() : decoded
  } catch {
    return value.trim()
  }
}
