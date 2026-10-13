// Gravador do navegador: roda num Web Worker para nao sofrer o "throttling" de abas
// em segundo plano. Usa o motor compartilhado (recordCore), grava no disco do
// navegador (OPFS) e, ao terminar, move o arquivo para a pasta escolhida.

import { smartFetch, type NetConfig } from './net'
import { detectFormat, StreamRecorder } from './recordCore'
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
  recorder: StreamRecorder
  stoppedByUser: boolean
  writer?: Writer
  opfsName?: string
  lastPost: number
}

const ctx = self as unknown as {
  postMessage(message: WorkerOut): void
  onmessage: ((event: MessageEvent<WorkerIn>) => void) | null
}
const recs = new Map<string, Rec>()

ctx.onmessage = (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  if (message.type === 'start') void start(message.job)
  const rec = 'id' in message ? recs.get(message.id) : undefined
  if (!rec) return
  if (message.type === 'stop') {
    rec.stoppedByUser = true
    rec.recorder.stop()
  }
  if (message.type === 'extend') {
    rec.job.stopAt = message.stopAt
    rec.info.stopAt = message.stopAt
    post(rec, true)
  }
}

// Relogio do agendador: timers de worker nao sao estrangulados em abas ocultas.
setInterval(() => ctx.postMessage({ type: 'tick' } satisfies WorkerOut), 10_000)

function post(rec: Rec, force = false) {
  const now = Date.now()
  if (!force && now - rec.lastPost < 2000) return
  rec.lastPost = now
  ctx.postMessage({ type: 'update', info: { ...rec.info } } satisfies WorkerOut)
}

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
    stoppedByUser: false,
    lastPost: 0,
    recorder: undefined as unknown as StreamRecorder,
  }
  rec.recorder = new StreamRecorder({
    urls: job.urls,
    hlsQuality: job.hlsQuality,
    getStopAt: () => job.stopAt,
    fetch: (url, signal) => smartFetch(url, job.net, { signal }, job.headers),
    onStatus: (status, message) => {
      rec.info.status = status
      rec.info.message = message
      post(rec, true)
    },
    write: (data) => write(rec, data),
  })
  recs.set(job.id, rec)
  post(rec, true)
  await rec.recorder.run()
  if (rec.stoppedByUser) rec.info.status = 'stopped'
  await finish(rec)
}

// ---------- escrita ----------

async function write(rec: Rec, data: Uint8Array) {
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
