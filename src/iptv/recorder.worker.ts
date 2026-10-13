// Gravador: roda num Web Worker para nao sofrer o "throttling" de abas em
// segundo plano. Baixa o stream (HLS segmento a segmento, ou MPEG-TS continuo),
// grava direto no disco do navegador (OPFS) e, ao terminar, move o arquivo para
// a pasta escolhida pelo usuario.

import { decryptSegment, parseHls, type HlsSegment, type MediaPlaylist } from './hls'
import { HttpError, smartFetch, type NetConfig } from './net'
import type { RecordingInfo, StreamHeaders } from './types'

export type RecordJob = {
  id: string
  occurrenceKey?: string
  title: string
  channelName: string
  urls: string[]
  headers?: StreamHeaders
  stopAt: number
  fileBase: string
  net: NetConfig
  hlsQuality: 'best' | 'lowest'
  folder?: FileSystemDirectoryHandle | null
}

export type WorkerIn =
  | { type: 'start'; job: RecordJob }
  | { type: 'stop'; id: string }
  | { type: 'extend'; id: string; stopAt: number }

export type WorkerOut = { type: 'tick' } | { type: 'update'; info: RecordingInfo }

type SyncHandle = {
  write(buffer: BufferSource, options?: { at?: number }): number
  flush(): void
  close(): void
  getSize(): number
}

type Writer = { write(data: Uint8Array): Promise<void>; close(): Promise<void> }

type Rec = {
  job: RecordJob
  info: RecordingInfo
  controller: AbortController
  stopped: boolean
  writer?: Writer
  opfsName?: string
  lastSeq: number
  lastMap?: string
  keys: Map<string, ArrayBuffer>
  lastPost: number
  wake?: () => void
}

const ctx = self as unknown as {
  postMessage(message: WorkerOut): void
  onmessage: ((event: MessageEvent<WorkerIn>) => void) | null
}
const recs = new Map<string, Rec>()

ctx.onmessage = (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  if (message.type === 'start') void start(message.job)
  if (message.type === 'stop') {
    const rec = recs.get(message.id)
    if (rec) stop(rec, 'stopped')
  }
  if (message.type === 'extend') {
    const rec = recs.get(message.id)
    if (rec) {
      rec.job.stopAt = message.stopAt
      rec.info.stopAt = message.stopAt
      post(rec, true)
    }
  }
}

// Relogio do agendador: timers de worker nao sao estrangulados em abas ocultas.
setInterval(() => ctx.postMessage({ type: 'tick' } satisfies WorkerOut), 10_000)
setInterval(() => {
  const now = Date.now()
  for (const rec of recs.values()) if (!rec.stopped && now >= rec.job.stopAt) stop(rec, 'done')
}, 1000)

function stop(rec: Rec, status: 'done' | 'stopped') {
  if (rec.stopped) return
  rec.stopped = true
  rec.info.status = status === 'done' ? 'finishing' : 'stopped'
  rec.controller.abort()
  rec.wake?.()
}

function post(rec: Rec, force = false) {
  const now = Date.now()
  if (!force && now - rec.lastPost < 2000) return
  rec.lastPost = now
  ctx.postMessage({ type: 'update', info: { ...rec.info } } satisfies WorkerOut)
}

function setStatus(rec: Rec, status: RecordingInfo['status'], message?: string) {
  rec.info.status = status
  rec.info.message = message
  post(rec, true)
}

const sleep = (rec: Rec, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      rec.wake = undefined
      resolve()
    }
    rec.wake = done
  })

async function start(job: RecordJob) {
  if (recs.has(job.id)) return
  const rec: Rec = {
    job,
    info: {
      id: job.id,
      occurrenceKey: job.occurrenceKey,
      title: job.title,
      channelName: job.channelName,
      fileName: `${job.fileBase}.ts`,
      startedAt: Date.now(),
      stopAt: job.stopAt,
      bytes: 0,
      status: 'starting',
    },
    controller: new AbortController(),
    stopped: false,
    lastSeq: -1,
    keys: new Map(),
    lastPost: 0,
  }
  recs.set(job.id, rec)
  post(rec, true)

  let failures = 0
  let urlIndex = 0
  while (!rec.stopped && Date.now() < job.stopAt) {
    const url = job.urls[urlIndex % job.urls.length]
    const before = rec.info.bytes
    try {
      await recordFrom(rec, url)
      if (!rec.stopped) setStatus(rec, 'reconnecting', 'O servidor encerrou a conexao, reconectando...')
    } catch (error) {
      if (rec.stopped) break
      const message = error instanceof Error ? error.message : String(error)
      setStatus(rec, 'reconnecting', `Falha: ${message}. Tentando de novo...`)
    }
    if (rec.stopped) break
    failures = rec.info.bytes > before ? 0 : failures + 1
    // Depois de 2 falhas seguidas na mesma URL, tenta a alternativa (.m3u8 <-> .ts).
    if (failures > 0 && failures % 2 === 0) urlIndex += 1
    rec.controller = new AbortController()
    await sleep(rec, Math.min(15_000, 1000 + failures * 2000))
  }

  await finish(rec)
}

async function recordFrom(rec: Rec, url: string) {
  const { response, finalUrl } = await smartFetch(url, rec.job.net, { signal: rec.controller.signal }, rec.job.headers)
  if (!response.ok || !response.body) throw new HttpError(response.status, `HTTP ${response.status}`)

  const reader = response.body.getReader()
  const first = await reader.read()
  if (first.done || !first.value) throw new Error('stream vazio')

  const head = new TextDecoder().decode(first.value.slice(0, 16)).trimStart()
  if (head.startsWith('#EXTM3U')) {
    let text = new TextDecoder().decode(first.value)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    await recordHls(rec, url, text, finalUrl)
    return
  }

  setStatus(rec, 'recording')
  await write(rec, first.value)
  for (;;) {
    const { done, value } = await reader.read()
    if (done || rec.stopped) break
    await write(rec, value)
  }
}

async function recordHls(rec: Rec, requestUrl: string, text: string, baseUrl: string) {
  let playlistUrl = requestUrl
  let parsed = parseHls(text, baseUrl)
  if (parsed.kind === 'master') {
    const variants = [...parsed.variants].sort((a, b) => a.bandwidth - b.bandwidth)
    const variant = rec.job.hlsQuality === 'lowest' ? variants[0] : variants[variants.length - 1]
    if (!variant) throw new Error('playlist HLS sem variantes')
    playlistUrl = variant.uri
    parsed = await loadMedia(rec, playlistUrl)
  }

  setStatus(rec, 'recording')
  let playlist = parsed as MediaPlaylist
  let stale = 0
  while (!rec.stopped) {
    const segments = playlist.segments
    const newest = segments[segments.length - 1]
    let pending: HlsSegment[]
    if (rec.lastSeq < 0 || (newest && newest.seq < rec.lastSeq - 10)) {
      // inicio (ou stream reiniciado): comeca perto do ao vivo
      pending = segments.slice(-3)
    } else {
      pending = segments.filter((segment) => segment.seq > rec.lastSeq)
    }

    for (const segment of pending) {
      if (rec.stopped) return
      if (segment.map && segment.map !== rec.lastMap) {
        await write(rec, new Uint8Array(await fetchBytes(rec, segment.map)))
        rec.lastMap = segment.map
      }
      let data = await fetchBytes(rec, segment.uri)
      if (segment.key?.method === 'AES-128' && segment.key.uri) {
        let key = rec.keys.get(segment.key.uri)
        if (!key) {
          key = await fetchBytes(rec, segment.key.uri)
          rec.keys.set(segment.key.uri, key)
        }
        data = await decryptSegment(data, key, segment.key, segment.seq)
      }
      await write(rec, new Uint8Array(data))
      rec.lastSeq = segment.seq
    }

    if (playlist.endList) return
    stale = pending.length ? 0 : stale + 1
    if (stale > 20) throw new Error('playlist HLS parou de atualizar')
    const waitMs = Math.min(6000, Math.max(1000, (playlist.targetDuration * 1000) / 2))
    await sleep(rec, waitMs)
    if (rec.stopped) return
    playlist = await loadMedia(rec, playlistUrl)
  }
}

async function loadMedia(rec: Rec, url: string): Promise<MediaPlaylist> {
  const { response, finalUrl } = await smartFetch(url, rec.job.net, { signal: rec.controller.signal }, rec.job.headers)
  if (!response.ok) throw new HttpError(response.status, `playlist HTTP ${response.status}`)
  const parsed = parseHls(await response.text(), finalUrl)
  if (parsed.kind !== 'media') throw new Error('playlist HLS inesperada')
  return parsed
}

async function fetchBytes(rec: Rec, url: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { response } = await smartFetch(url, rec.job.net, { signal: rec.controller.signal }, rec.job.headers)
      if (!response.ok) throw new HttpError(response.status, `segmento HTTP ${response.status}`)
      return await response.arrayBuffer()
    } catch (error) {
      if (rec.stopped || attempt >= 2) throw error
      await sleep(rec, 800)
    }
  }
}

// ---------- escrita ----------

function detectFormat(bytes: Uint8Array): 'ts' | 'mp4' {
  const box = String.fromCharCode(...bytes.slice(4, 8))
  if (['ftyp', 'styp', 'moof', 'moov', 'sidx'].includes(box)) return 'mp4'
  return 'ts'
}

async function write(rec: Rec, data: Uint8Array) {
  if (!data.byteLength) return
  if (!rec.writer) {
    const format = detectFormat(data)
    rec.info.format = format
    rec.info.fileName = `${rec.job.fileBase}.${format}`
    const { writer, name } = await openOpfsWriter(rec.info.fileName)
    rec.writer = writer
    rec.opfsName = name
  }
  await rec.writer.write(data)
  rec.info.bytes += data.byteLength
  post(rec)
}

async function recordingsDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('recordings', { create: true })
}

async function openOpfsWriter(fileName: string): Promise<{ writer: Writer; name: string }> {
  const dir = await recordingsDir()
  const name = await uniqueName(dir, fileName)
  const handle = await dir.getFileHandle(name, { create: true })
  const withSync = handle as FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncHandle> }

  if (withSync.createSyncAccessHandle) {
    // Escrita direta no arquivo: o que ja foi gravado sobrevive se a aba fechar.
    const sync = await withSync.createSyncAccessHandle()
    let offset = sync.getSize()
    let lastFlush = Date.now()
    return {
      name,
      writer: {
        async write(data) {
          offset += sync.write(data as Uint8Array<ArrayBuffer>, { at: offset })
          if (Date.now() - lastFlush > 5000) {
            sync.flush()
            lastFlush = Date.now()
          }
        },
        async close() {
          sync.flush()
          sync.close()
        },
      },
    }
  }

  const writable = await handle.createWritable()
  return {
    name,
    writer: {
      write: (data) => writable.write(data as unknown as ArrayBuffer),
      close: () => writable.close(),
    },
  }
}

async function uniqueName(dir: FileSystemDirectoryHandle, fileName: string) {
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  for (let index = 1; index < 100; index += 1) {
    const candidate = index === 1 ? fileName : `${base} (${index})${ext}`
    try {
      await dir.getFileHandle(candidate)
    } catch {
      return candidate
    }
  }
  return `${base} ${Date.now()}${ext}`
}

async function finish(rec: Rec) {
  const finalStatus = rec.info.status === 'stopped' ? 'stopped' : rec.info.bytes > 0 ? 'done' : 'failed'
  if (!rec.writer) {
    rec.info.status = 'failed'
    rec.info.message = rec.info.message || 'Nenhum dado recebido do canal.'
    rec.info.endedAt = Date.now()
    post(rec, true)
    recs.delete(rec.job.id)
    return
  }

  rec.info.status = 'finishing'
  rec.info.message = 'Salvando arquivo...'
  post(rec, true)
  try {
    await rec.writer.close()
  } catch {
    // arquivo pode ja estar fechado
  }

  rec.info.savedTo = 'browser'
  rec.info.message = undefined
  if (rec.job.folder && rec.opfsName) {
    try {
      const dir = await recordingsDir()
      const source = await dir.getFileHandle(rec.opfsName)
      const name = await uniqueName(rec.job.folder, rec.opfsName)
      const target = await rec.job.folder.getFileHandle(name, { create: true })
      const writable = await target.createWritable()
      await (await source.getFile()).stream().pipeTo(writable)
      await dir.removeEntry(rec.opfsName)
      rec.info.fileName = name
      rec.info.savedTo = 'folder'
    } catch (error) {
      rec.info.message = `Ficou salvo no navegador (sem acesso a pasta: ${error instanceof Error ? error.message : error}).`
    }
  } else {
    rec.info.fileName = rec.opfsName ?? rec.info.fileName
  }

  rec.info.status = finalStatus === 'failed' ? 'failed' : finalStatus
  rec.info.endedAt = Date.now()
  post(rec, true)
  recs.delete(rec.job.id)
}
