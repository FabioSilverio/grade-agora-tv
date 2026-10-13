// Contrato entre o site e o gravador do PC (server/local). So tipos.
import type { ChannelRef, Occurrence, PlaylistConfig, RecordingInfo, RecordingRule } from './types'

export const LOCAL_API_VERSION = 1

export type LocalSettings = {
  padBeforeMin: number
  padAfterMin: number
  hlsQuality: 'best' | 'lowest'
  userAgent: string
}

export type LocalPlaylist = PlaylistConfig & {
  /** URLs XMLTV ja resolvidas (absolutas) para os modos provider-xmltv/custom. */
  epgSources?: string[]
}

export type LocalSyncPayload = {
  rules: RecordingRule[]
  playlists: LocalPlaylist[]
  settings: LocalSettings
}

export type LocalStatus = {
  ok: true
  version: number
  outputDir: string
  active: number
  rules: number
  syncedAt?: number
  keepAwake: boolean
  platform: string
}

export type LocalFile = { name: string; size: number; modified: number }

export type LocalRecordings = {
  active: RecordingInfo[]
  history: RecordingInfo[]
  files: LocalFile[]
  upcoming: Occurrence[]
}

export type LocalRecordRequest = {
  channel: ChannelRef
  title: string
  stopAt: number
  programStart?: number
}
