// Gravador do PC: proxy IPTV + agendador + gravador, rodando em segundo plano.
// Grava os agendamentos mesmo com o site fechado. O site sincroniza as regras com
// ele em http://127.0.0.1:8787/api/local/*.
//
//   npm run local       (gera server/dist/local.mjs e inicia)
//
// No Windows, scripts\windows\instalar-proxy.cmd instala para iniciar com o sistema.

import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir, platform } from 'node:os'
import { basename, extname, join } from 'node:path'
import { recordingFileBase } from '../../src/iptv/format'
import {
  LOCAL_API_VERSION,
  type LocalFile,
  type LocalPlaylist,
  type LocalRecordRequest,
  type LocalRecordings,
  type LocalSettings,
  type LocalStatus,
  type LocalSyncPayload,
} from '../../src/iptv/localApi'
import { maybeGunzip } from '../../src/iptv/net'
import { detectFormat, StreamRecorder } from '../../src/iptv/recordCore'
import { computeOccurrences } from '../../src/iptv/schedule'
import type { ChannelRef, Occurrence, Programme, RecordingInfo, RecordingRule } from '../../src/iptv/types'
import { normalizeName, parseXmltvStream } from '../../src/iptv/xmltv'
import { parseEpgListings } from '../../src/iptv/xtream'
// @ts-expect-error modulo JS sem tipos, compartilhado com a funcao da Vercel
import { proxyNodeRequest } from '../node-adapter.js'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const DEFAULT_UA = 'VLC/3.0.21 LibVLC/3.0.21'
const MIN = 60_000
const HOUR = 60 * MIN

const DATA_DIR =
  process.env.GRADE_AGORA_DATA ||
  (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'GradeAgora') : join(homedir(), '.grade-agora'))
const STATE_FILE = join(DATA_DIR, 'estado.json')
const DEFAULT_OUTPUT = process.env.GRADE_AGORA_OUTPUT || join(homedir(), 'Videos', 'Grade Agora')

// Sites que podem falar com o gravador (o navegador manda Origin em toda chamada).
const EXTRA_ORIGINS = (process.env.GRADE_AGORA_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)
function originAllowed(origin: string) {
  return (
    /^https:\/\/grade-agora[a-z0-9-]*\.vercel\.app$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    EXTRA_ORIGINS.includes(origin)
  )
}

const log = (...args: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...args)

// ---------- estado persistido ----------

type Started = { recId: string; ruleId: string; start: number; stop: number }

type State = {
  rules: RecordingRule[]
  playlists: LocalPlaylist[]
  settings: LocalSettings
  outputDir: string
  started: Record<string, Started>
  history: RecordingInfo[]
  syncedAt?: number
}

let state: State = {
  rules: [],
  playlists: [],
  settings: { padBeforeMin: 2, padAfterMin: 5, hlsQuality: 'best', userAgent: '' },
  outputDir: DEFAULT_OUTPUT,
  started: {},
  history: [],
}

async function loadState() {
  try {
    const saved = JSON.parse(await readFile(STATE_FILE, 'utf8')) as Partial<State>
    state = { ...state, ...saved, settings: { ...state.settings, ...saved.settings } }
  } catch {
    // primeira execucao
  }
  // Reinicio do PC no meio de uma gravacao: ela recomeca numa nova parte.
  const now = Date.now()
  state.started = Object.fromEntries(Object.entries(state.started).filter(([, item]) => item.stop < now))
  state.history = state.history.map((info) =>
    ['starting', 'recording', 'reconnecting', 'finishing'].includes(info.status)
      ? { ...info, status: 'failed', message: 'Interrompida (o PC ou o gravador foi desligado).' }
      : info,
  )
}

let saveTimer: NodeJS.Timeout | undefined
function saveState() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(DATA_DIR, { recursive: true })
      const tmp = `${STATE_FILE}.tmp`
      await writeFile(tmp, JSON.stringify(state, null, 1))
      await rename(tmp, STATE_FILE)
    } catch (error) {
      log('erro ao salvar estado:', error)
    }
  }, 500)
}

// ---------- EPG ----------

type EpgCache = { at: number; list: Programme[] | null; loading?: Promise<void> }
const epgCache = new Map<string, EpgCache>()
const xmltvCache = new Map<string, { at: number; index: Awaited<ReturnType<typeof parseXmltvStream>> | null; loading?: Promise<void> }>()
const EPG_TTL = 20 * MIN
const XMLTV_TTL = 6 * HOUR

async function httpGet(url: string, signal?: AbortSignal, headers?: ChannelRef['headers']) {
  const response = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent': headers?.userAgent || state.settings.userAgent || DEFAULT_UA,
      ...(headers?.referer ? { Referer: headers.referer } : {}),
    },
  })
  return { response, finalUrl: response.url || url }
}

async function loadXtreamEpg(playlist: LocalPlaylist, streamId: number) {
  if (playlist.kind !== 'xtream') return []
  const base = `${playlist.server}/player_api.php?username=${encodeURIComponent(playlist.username)}&password=${encodeURIComponent(playlist.password)}`
  const get = async (action: string) => {
    const { response } = await httpGet(`${base}&action=${action}&stream_id=${streamId}${action === 'get_short_epg' ? '&limit=50' : ''}`, AbortSignal.timeout(30_000))
    if (!response.ok) throw new Error(`EPG HTTP ${response.status}`)
    return parseEpgListings((await response.json()) as Parameters<typeof parseEpgListings>[0])
  }
  const list = await get('get_simple_data_table')
  return list.length ? list : get('get_short_epg').catch(() => [])
}

async function loadXmltv(playlist: LocalPlaylist) {
  const channels = state.rules.filter((rule) => rule.channel.playlistId === playlist.id).map((rule) => rule.channel)
  const wantedIds = new Set(channels.map((channel) => channel.epgId?.toLowerCase()).filter((id): id is string => Boolean(id)))
  const wantedNames = new Set(channels.map((channel) => normalizeName(channel.name)).filter(Boolean))
  let merged: Awaited<ReturnType<typeof parseXmltvStream>> | null = null
  for (const source of playlist.epgSources ?? []) {
    try {
      const { response } = await httpGet(source, AbortSignal.timeout(10 * MIN))
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const index = await parseXmltvStream(await maybeGunzip(response.body), {
        wantedIds,
        wantedNames,
        from: Date.now() - 12 * HOUR,
        to: Date.now() + 8 * 24 * HOUR,
      })
      merged ??= { programmes: {}, names: {} }
      for (const [id, list] of Object.entries(index.programmes)) merged.programmes[id] ??= list
      for (const [name, id] of Object.entries(index.names)) merged.names[name] ??= id
    } catch (error) {
      log(`EPG XMLTV falhou (${playlist.name}):`, error instanceof Error ? error.message : error)
    }
  }
  return merged
}

/** EPG do canal da regra. Usa o cache (mesmo velho) e atualiza em segundo plano. */
async function programmesFor(rule: RecordingRule): Promise<Programme[] | null> {
  if (rule.kind === 'once') return null
  const playlist = state.playlists.find((item) => item.id === rule.channel.playlistId)
  if (!playlist || playlist.epgMode === 'none') return null
  const shift = (playlist.epgShiftHours ?? 0) * HOUR
  const shifted = (list: Programme[] | null) =>
    list && shift ? list.map((item) => ({ ...item, start: item.start + shift, stop: item.stop + shift })) : list

  if (playlist.epgMode === 'xtream-api') {
    if (!rule.channel.streamId) return null
    const key = `${playlist.id}:${rule.channel.streamId}`
    let entry = epgCache.get(key)
    if (!entry || (Date.now() - entry.at > EPG_TTL && !entry.loading)) {
      const current = entry ?? { at: 0, list: null }
      epgCache.set(key, current)
      current.loading = loadXtreamEpg(playlist, rule.channel.streamId)
        .then((list) => {
          current.list = list
          current.at = Date.now()
        })
        .catch((error) => {
          current.at = Date.now() - EPG_TTL + 2 * MIN // tenta de novo em 2 min
          log(`EPG falhou (${rule.channel.name}):`, error instanceof Error ? error.message : error)
        })
        .finally(() => {
          current.loading = undefined
        })
      if (!entry) await current.loading
      entry = current
    }
    return shifted(entry.list)
  }

  let entry = xmltvCache.get(playlist.id)
  if (!entry || (Date.now() - entry.at > XMLTV_TTL && !entry.loading)) {
    const current = entry ?? { at: 0, index: null }
    xmltvCache.set(playlist.id, current)
    current.loading = loadXmltv(playlist)
      .then((index) => {
        current.index = index
        current.at = Date.now()
      })
      .finally(() => {
        current.loading = undefined
      })
    if (!entry) await current.loading
    entry = current
  }
  const index = entry.index
  if (!index) return null
  const byId = rule.channel.epgId ? index.programmes[rule.channel.epgId.toLowerCase()] : undefined
  const byName = index.names[normalizeName(rule.channel.name)]
  return shifted(byId ?? (byName ? index.programmes[byName] : undefined) ?? [])
}

// ---------- gravacoes ----------

type Active = {
  info: RecordingInfo
  recorder: StreamRecorder
  stopAt: number
  stoppedByUser: boolean
  file?: WriteStream
  path?: string
}
const active = new Map<string, Active>()
let upcoming: Occurrence[] = []

function uid() {
  return `rec${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function channelUrls(channel: ChannelRef) {
  const alts = channel.altUrls ?? []
  return [...new Set([...alts.filter((url) => /\.m3u8/i.test(url)), channel.url, ...alts])]
}

async function uniquePath(dir: string, name: string) {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let index = 1; index < 200; index += 1) {
    const candidate = join(dir, index === 1 ? name : `${base} (${index})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return join(dir, `${base} ${Date.now()}${ext}`)
}

function startRecording(request: LocalRecordRequest & { occurrenceKey?: string }) {
  const id = uid()
  const when = new Date(request.programStart ?? Date.now())
  const fileBase = recordingFileBase(request.channel.name, request.title, when)
  const rec: Active = {
    info: {
      id,
      occurrenceKey: request.occurrenceKey,
      title: request.title,
      channelName: request.channel.name,
      fileName: `${fileBase}.ts`,
      startedAt: Date.now(),
      stopAt: request.stopAt,
      bytes: 0,
      status: 'starting',
      savedTo: 'folder',
    },
    stopAt: request.stopAt,
    stoppedByUser: false,
    recorder: undefined as unknown as StreamRecorder,
  }

  rec.recorder = new StreamRecorder({
    urls: channelUrls(request.channel),
    hlsQuality: state.settings.hlsQuality,
    getStopAt: () => rec.stopAt,
    fetch: (url, signal) => httpGet(url, signal, request.channel.headers),
    onStatus: (status, message) => {
      if (status !== rec.info.status || message) log(`${rec.info.title}: ${status}${message ? ` - ${message}` : ''}`)
      rec.info.status = status
      rec.info.message = message
    },
    write: async (data) => {
      if (!rec.file) {
        const format = detectFormat(data)
        await mkdir(state.outputDir, { recursive: true })
        rec.path = await uniquePath(state.outputDir, `${fileBase}.${format}`)
        rec.info.format = format
        rec.info.fileName = basename(rec.path)
        rec.file = createWriteStream(rec.path, { flags: 'a' })
      }
      const file = rec.file
      rec.info.bytes += data.byteLength
      if (!file.write(data)) await new Promise<void>((resolve) => file.once('drain', () => resolve()))
    },
  })

  active.set(id, rec)
  log(`Gravando "${request.title}" (${request.channel.name}) ate ${new Date(request.stopAt).toLocaleString()}`)
  void rec.recorder.run().then(async () => {
    if (rec.file) await new Promise<void>((resolve) => rec.file!.end(() => resolve()))
    rec.info.status = rec.stoppedByUser ? 'stopped' : rec.info.bytes > 0 ? 'done' : 'failed'
    if (!rec.info.bytes) rec.info.message = rec.info.message || 'Nenhum dado recebido do canal.'
    else if (rec.info.status === 'done') rec.info.message = undefined
    rec.info.endedAt = Date.now()
    active.delete(id)
    state.history = [rec.info, ...state.history].slice(0, 200)
    saveState()
    log(`Fim de "${rec.info.title}": ${rec.info.status}, ${(rec.info.bytes / 1e6).toFixed(1)} MB em ${rec.path ?? '-'}`)
    void tick()
  })
  return id
}

// ---------- agendador ----------

let ticking = false
async function tick() {
  if (ticking) return
  ticking = true
  try {
    const now = Date.now()
    const all: Occurrence[] = []
    for (const rule of state.rules) {
      if (!rule.enabled) continue
      let programmes: Programme[] | null = null
      try {
        programmes = await programmesFor(rule)
      } catch (error) {
        log('EPG:', error)
      }
      all.push(...computeOccurrences(rule, programmes, now - 6 * HOUR, now + 7 * 24 * HOUR))
    }

    for (const occurrence of all) {
      if (occurrence.start > now || occurrence.stop <= now) continue
      const existingKey = Object.keys(state.started).find((key) => {
        const item = state.started[key]
        return key === occurrence.key || (item.ruleId === occurrence.ruleId && item.start < occurrence.stop && item.stop > occurrence.start)
      })
      if (existingKey) {
        const item = state.started[existingKey]
        const rec = active.get(item.recId)
        if (rec && item.stop !== occurrence.stop) {
          // EPG mudou o fim (atraso, prorrogacao): acompanha.
          rec.stopAt = occurrence.stop
          rec.info.stopAt = occurrence.stop
          item.stop = occurrence.stop
          saveState()
        }
        continue
      }
      const recId = startRecording({
        channel: occurrence.channel,
        title: occurrence.title,
        stopAt: occurrence.stop,
        programStart: occurrence.programStart,
        occurrenceKey: occurrence.key,
      })
      state.started[occurrence.key] = { recId, ruleId: occurrence.ruleId, start: occurrence.start, stop: occurrence.stop }
      saveState()
    }

    for (const [key, item] of Object.entries(state.started)) if (item.stop < now - 3 * 24 * HOUR) delete state.started[key]
    upcoming = all.filter((item) => item.stop > now).sort((a, b) => a.start - b.start)
    updateKeepAwake()
  } finally {
    ticking = false
  }
}

// ---------- impedir o Windows de dormir enquanto houver agendamentos ----------

let awake: ChildProcess | null = null
function updateKeepAwake() {
  const needed = active.size > 0 || state.rules.some((rule) => rule.enabled)
  if (platform() !== 'win32') return
  if (needed && !awake) {
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED: o Windows nao suspende sozinho enquanto este processo existir.
    const script =
      "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';" +
      '[W.P]::SetThreadExecutionState([uint32]2147483649) | Out-Null; while ($true) { Start-Sleep -Seconds 3600 }'
    awake = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' })
    awake.on('exit', () => {
      awake = null
    })
    log('Mantendo o PC acordado (ha agendamentos).')
  } else if (!needed && awake) {
    awake.kill()
    awake = null
  }
}
process.on('exit', () => awake?.kill())

// ---------- API HTTP ----------

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (!origin) return true
  if (!originAllowed(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Grade-Agora, Range')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range')
  return true
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 20 * 1024 * 1024) throw new Error('corpo grande demais')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
}

async function listFiles(): Promise<LocalFile[]> {
  try {
    const names = await readdir(state.outputDir)
    const files: LocalFile[] = []
    for (const name of names) {
      if (!/\.(ts|mp4|mkv|m2ts)$/i.test(name)) continue
      const info = await stat(join(state.outputDir, name)).catch(() => null)
      if (info?.isFile()) files.push({ name, size: info.size, modified: info.mtimeMs })
    }
    return files.sort((a, b) => b.modified - a.modified)
  } catch {
    return []
  }
}

function safeFile(name: unknown) {
  if (typeof name !== 'string' || !name || name !== basename(name) || name.startsWith('.')) return null
  return join(state.outputDir, name)
}

async function serveFile(req: IncomingMessage, res: ServerResponse, path: string) {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return sendJson(res, 404, { error: 'arquivo nao encontrado' })
  const type = path.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t'
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${info.size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(path, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Accept-Ranges': 'bytes' })
  createReadStream(path).pipe(res)
}

function openFolder(path: string) {
  const command = platform() === 'win32' ? 'explorer.exe' : platform() === 'darwin' ? 'open' : 'xdg-open'
  spawn(command, [path], { detached: true, stdio: 'ignore' }).unref()
}

function statusBody(): LocalStatus {
  return {
    ok: true,
    version: LOCAL_API_VERSION,
    outputDir: state.outputDir,
    active: active.size,
    rules: state.rules.filter((rule) => rule.enabled).length,
    syncedAt: state.syncedAt,
    keepAwake: Boolean(awake),
    platform: platform(),
  }
}

async function handleLocal(req: IncomingMessage, res: ServerResponse, url: URL) {
  const route = `${req.method} ${url.pathname.replace(/^\/api\/local/, '')}`
  switch (route) {
    case 'GET /status':
      return sendJson(res, 200, statusBody())

    case 'PUT /state': {
      const body = await readJson<LocalSyncPayload>(req)
      if (!Array.isArray(body.rules) || !Array.isArray(body.playlists)) return sendJson(res, 400, { error: 'payload invalido' })
      const playlistsChanged = JSON.stringify(body.playlists) !== JSON.stringify(state.playlists)
      state.rules = body.rules
      state.playlists = body.playlists
      state.settings = { ...state.settings, ...body.settings }
      state.syncedAt = Date.now()
      if (playlistsChanged) {
        epgCache.clear()
        xmltvCache.clear()
      }
      saveState()
      void tick()
      return sendJson(res, 200, statusBody())
    }

    case 'GET /recordings': {
      const body: LocalRecordings = {
        active: [...active.values()].map((rec) => ({ ...rec.info })),
        history: state.history,
        files: await listFiles(),
        upcoming,
      }
      return sendJson(res, 200, body)
    }

    case 'POST /record': {
      const body = await readJson<LocalRecordRequest>(req)
      if (!body.channel?.url || !body.stopAt) return sendJson(res, 400, { error: 'canal ou horario faltando' })
      const id = startRecording({ ...body, stopAt: Math.min(body.stopAt, Date.now() + 24 * HOUR) })
      return sendJson(res, 200, { id })
    }

    case 'POST /stop': {
      const { id } = await readJson<{ id: string }>(req)
      const rec = active.get(id)
      if (rec) {
        rec.stoppedByUser = true
        rec.recorder.stop()
      }
      return sendJson(res, 200, { ok: Boolean(rec) })
    }

    case 'POST /output-dir': {
      const { path } = await readJson<{ path: string }>(req)
      if (!path?.trim()) return sendJson(res, 400, { error: 'pasta invalida' })
      try {
        await mkdir(path.trim(), { recursive: true })
        const probe = join(path.trim(), '.grade-agora-teste')
        await writeFile(probe, 'ok')
        await unlink(probe)
      } catch (error) {
        return sendJson(res, 400, { error: `Nao consegui gravar nessa pasta: ${error instanceof Error ? error.message : error}` })
      }
      state.outputDir = path.trim()
      saveState()
      return sendJson(res, 200, statusBody())
    }

    case 'POST /open-folder':
      await mkdir(state.outputDir, { recursive: true }).catch(() => undefined)
      openFolder(state.outputDir)
      return sendJson(res, 200, { ok: true })

    case 'POST /delete': {
      const { name } = await readJson<{ name: string }>(req)
      const path = safeFile(name)
      if (!path) return sendJson(res, 400, { error: 'nome invalido' })
      if ([...active.values()].some((rec) => rec.path === path)) return sendJson(res, 409, { error: 'arquivo em gravacao' })
      await unlink(path).catch(() => undefined)
      return sendJson(res, 200, { ok: true })
    }

    case 'GET /file': {
      const path = safeFile(url.searchParams.get('name'))
      if (!path) return sendJson(res, 400, { error: 'nome invalido' })
      return serveFile(req, res, path)
    }
  }
  return sendJson(res, 404, { error: 'rota desconhecida' })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (url.pathname.startsWith('/api/proxy')) {
    void proxyNodeRequest(req, res, { allowPrivateHosts: true, allowCrossSite: true })
    return
  }

  if (url.pathname.startsWith('/api/local')) {
    if (!cors(req, res)) return sendJson(res, 403, { error: 'origem nao permitida' })
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    handleLocal(req, res, url).catch((error) => {
      log('erro na API:', error)
      if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(`Grade Agora proxy local ativo (gravador v${LOCAL_API_VERSION}). Use /api/proxy?url=...`)
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    log(`Porta ${PORT} ja esta em uso (gravador ja ativo?).`)
    process.exit(3)
  }
  throw error
})

process.on('uncaughtException', (error) => log('erro:', error))
process.on('unhandledRejection', (error) => log('erro:', error))

await loadState()
server.listen(PORT, HOST, () => {
  log(`Gravador e proxy em http://${HOST}:${PORT} (dados: ${DATA_DIR}, gravacoes: ${state.outputDir})`)
})
setInterval(() => void tick(), 15_000)
void tick()
