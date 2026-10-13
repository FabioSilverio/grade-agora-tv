export type EpgMode = 'xtream-api' | 'provider-xmltv' | 'custom' | 'none'

export type PlaylistConfig = {
  id: string
  name: string
  epgMode: EpgMode
  customEpgUrl?: string
  /** Horas somadas aos horarios da EPG (corrige provedores com fuso errado). */
  epgShiftHours?: number
  createdAt: number
} & (
  | { kind: 'm3u'; url?: string; /** conteudo enviado por arquivo fica no IndexedDB */ fileName?: string }
  | { kind: 'xtream'; server: string; username: string; password: string }
)

export type StreamHeaders = { userAgent?: string; referer?: string }

export type Channel = {
  /** Unico dentro da playlist e estavel entre recargas. */
  id: string
  name: string
  logo?: string
  group: string
  url: string
  /** URLs alternativas tentadas em ordem se a principal falhar. */
  altUrls?: string[]
  epgId?: string
  streamId?: number
  num?: number
  headers?: StreamHeaders
}

export type VodItem = {
  id: string
  name: string
  logo?: string
  group: string
  url?: string
  streamId?: number
  ext?: string
  rating?: string
  year?: string
  headers?: StreamHeaders
}

export type SeriesItem = {
  id: string
  seriesId: number
  name: string
  cover?: string
  group: string
  plot?: string
  rating?: string
}

export type PlaylistData = {
  playlistId: string
  loadedAt: number
  channels: Channel[]
  movies: VodItem[]
  series: SeriesItem[]
  epgUrls: string[]
  accountInfo?: { maxConnections?: number; activeConnections?: number; expiresAt?: number; status?: string }
}

export type Programme = {
  start: number
  stop: number
  title: string
  desc?: string
  category?: string
}

export type ChannelRef = {
  playlistId: string
  channelId: string
  name: string
  url: string
  altUrls?: string[]
  epgId?: string
  streamId?: number
  logo?: string
  headers?: StreamHeaders
}

export type RuleKind = 'series' | 'daily' | 'once'

export type RecordingRule = {
  id: string
  kind: RuleKind
  enabled: boolean
  channel: ChannelRef
  /** series: titulo procurado na EPG. */
  title: string
  match: 'contains' | 'exact'
  /** Dias da semana (0 = domingo). */
  days: number[]
  /** Horario habitual HH:MM (daily e fallback/tolerancia das series). */
  time?: string
  durationMin?: number
  /** series: so grava exibicoes que comecam a ate N minutos do horario habitual. 0 = qualquer horario. */
  toleranceMin: number
  /** series: se a EPG do dia estiver vazia, grava no horario habitual. */
  fallbackToTime: boolean
  padBeforeMin: number
  padAfterMin: number
  /** once: janela exata (ms). */
  start?: number
  stop?: number
  createdAt: number
}

export type Occurrence = {
  key: string
  ruleId: string
  title: string
  channel: ChannelRef
  /** Inicio/fim ja com as margens aplicadas. */
  start: number
  stop: number
  programStart: number
  programStop: number
  source: 'epg' | 'time' | 'once' | 'manual'
}

export type RecordingStatus = 'starting' | 'recording' | 'reconnecting' | 'finishing' | 'done' | 'failed' | 'stopped'

export type RecordingInfo = {
  id: string
  occurrenceKey?: string
  title: string
  channelName: string
  fileName: string
  startedAt: number
  stopAt: number
  bytes: number
  status: RecordingStatus
  message?: string
  format?: 'ts' | 'mp4'
  savedTo?: 'folder' | 'browser'
  endedAt?: number
}

export type ProxyMode = 'auto' | 'always' | 'never'

export type Settings = {
  proxyMode: ProxyMode
  proxyBase: string
  userAgent: string
  preferHls: boolean
  hlsQuality: 'best' | 'lowest'
  padBeforeMin: number
  padAfterMin: number
  notifications: boolean
  /** Impede a tela/PC de dormir enquanto houver agendamentos ativos (aba visivel). */
  keepAwake: boolean
}
