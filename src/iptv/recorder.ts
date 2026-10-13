import { useSyncExternalStore } from 'react'
import { channelCandidates } from './playlists'
import type { RecordJob, WorkerIn, WorkerOut } from './recorder.worker'
import { netConfig, store } from './state'
import { recordingFileBase as fileBase } from './format'
import { idb, loadLocal, saveLocal, uid } from './storage'
import type { ChannelRef, RecordingInfo } from './types'

// ---------- estado observavel ----------

const HISTORY_KEY = 'iptv:recordings:v1'
const ACTIVE = new Set<RecordingInfo['status']>(['starting', 'recording', 'reconnecting', 'finishing'])

let recordings: RecordingInfo[] = loadLocal<RecordingInfo[]>(HISTORY_KEY, []).map((info) =>
  // Se a pagina fechou no meio de uma gravacao, o arquivo parcial ficou no navegador.
  ACTIVE.has(info.status) ? { ...info, status: 'failed', message: 'Interrompida (a pagina foi fechada).', savedTo: 'browser' } : info,
)
const listeners = new Set<() => void>()

function emit() {
  saveLocal(
    HISTORY_KEY,
    recordings.slice(0, 80),
  )
  listeners.forEach((listener) => listener())
}

export function useRecordings() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => recordings,
  )
}

export function isActive(info: RecordingInfo) {
  return ACTIVE.has(info.status)
}

export function activeRecordings() {
  return recordings.filter(isActive)
}

export function clearHistory() {
  recordings = recordings.filter(isActive)
  emit()
}

// ---------- worker ----------

let worker: Worker | null = null
const tickListeners = new Set<() => void>()
const doneListeners = new Set<(info: RecordingInfo) => void>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./recorder.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const message = event.data
    if (message.type === 'tick') {
      tickListeners.forEach((listener) => listener())
      return
    }
    const info = message.info
    const previous = recordings.find((item) => item.id === info.id)
    recordings = previous ? recordings.map((item) => (item.id === info.id ? info : item)) : [info, ...recordings]
    if (previous && isActive(previous) && !isActive(info)) {
      doneListeners.forEach((listener) => listener(info))
      notify(
        info.status === 'failed' ? 'Gravacao falhou' : 'Gravacao concluida',
        `${info.channelName} - ${info.title}${info.message ? `\n${info.message}` : ''}`,
      )
    }
    if (previous?.status === 'starting' && info.status === 'recording') {
      notify('Gravando', `${info.channelName} - ${info.title}`)
    }
    updateWakeLock()
    emit()
  }
  return worker
}

/** Relogio de 10 s vindo do worker (continua batendo com a aba em segundo plano). */
export function onTick(listener: () => void) {
  getWorker()
  tickListeners.add(listener)
  return () => tickListeners.delete(listener)
}

export function onRecordingDone(listener: (info: RecordingInfo) => void) {
  doneListeners.add(listener)
  return () => doneListeners.delete(listener)
}

function send(message: WorkerIn) {
  getWorker().postMessage(message)
}

export async function startRecording(options: {
  channel: ChannelRef
  title: string
  stopAt: number
  occurrenceKey?: string
  programStart?: number
}) {
  const settings = store.get().settings
  const folder = await getFolder({ requirePermission: true })
  const id = uid('rec')
  const when = new Date(options.programStart ?? Date.now())
  const job: RecordJob = {
    id,
    occurrenceKey: options.occurrenceKey,
    title: options.title,
    channelName: options.channel.name,
    urls: channelCandidates(options.channel),
    headers: options.channel.headers,
    stopAt: options.stopAt,
    fileBase: fileBase(options.channel.name, options.title, when),
    net: { ...netConfig(settings), base: new URL(settings.proxyBase || '/api/proxy', location.href).href },
    hlsQuality: settings.hlsQuality,
    folder: folder ?? null,
  }
  send({ type: 'start', job })
  return id
}

export function stopRecording(id: string) {
  send({ type: 'stop', id })
}

export function extendRecording(id: string, stopAt: number) {
  send({ type: 'extend', id, stopAt })
}

// ---------- pasta de gravacoes (File System Access API) ----------

const FOLDER_KEY = 'recfolder'
export const supportsFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
}

export type FolderState = { name: string | null; permission: PermissionState | 'none' }
let folderState: FolderState = { name: null, permission: 'none' }
const folderListeners = new Set<() => void>()
function setFolderState(next: FolderState) {
  folderState = next
  folderListeners.forEach((listener) => listener())
}

export function useFolderState() {
  return useSyncExternalStore(
    (listener) => {
      folderListeners.add(listener)
      return () => folderListeners.delete(listener)
    },
    () => folderState,
  )
}

export async function refreshFolderState() {
  const handle = (await idb.get<PermissionHandle>(FOLDER_KEY).catch(() => undefined)) ?? null
  if (!handle) {
    setFolderState({ name: null, permission: 'none' })
    return null
  }
  const permission = (await handle.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt' as const)) ?? 'granted'
  setFolderState({ name: handle.name, permission })
  return handle
}

async function getFolder({ requirePermission }: { requirePermission: boolean }) {
  const handle = await refreshFolderState()
  if (!handle) return null
  if (requirePermission && folderState.permission !== 'granted') return null
  return handle
}

export async function chooseFolder() {
  const picker = (window as unknown as { showDirectoryPicker: (options?: object) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker
  const handle = await picker({ id: 'grade-agora-gravacoes', mode: 'readwrite', startIn: 'videos' })
  await idb.set(FOLDER_KEY, handle)
  await refreshFolderState()
}

/** Precisa de um clique do usuario (o navegador exige gesto para reautorizar). */
export async function authorizeFolder() {
  const handle = (await idb.get<PermissionHandle>(FOLDER_KEY)) ?? null
  if (!handle?.requestPermission) return
  await handle.requestPermission({ mode: 'readwrite' })
  await refreshFolderState()
}

export async function forgetFolder() {
  await idb.del(FOLDER_KEY)
  await refreshFolderState()
}

// ---------- arquivos gravados ----------

export type StoredFile = { name: string; size: number; modified: number; location: 'folder' | 'browser' }

async function opfsRecordings() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('recordings', { create: true })
}

async function listDir(dir: FileSystemDirectoryHandle, location: StoredFile['location']) {
  const files: StoredFile[] = []
  const iterable = dir as unknown as { values(): AsyncIterable<FileSystemHandle> }
  for await (const entry of iterable.values()) {
    if (entry.kind !== 'file' || !/\.(ts|mp4|mkv|m2ts)$/i.test(entry.name)) continue
    try {
      const file = await (entry as FileSystemFileHandle).getFile()
      files.push({ name: entry.name, size: file.size, modified: file.lastModified, location })
    } catch {
      // arquivo em uso pelo gravador
      files.push({ name: entry.name, size: 0, modified: Date.now(), location })
    }
  }
  return files
}

export async function listFiles(): Promise<StoredFile[]> {
  const result: StoredFile[] = []
  try {
    result.push(...(await listDir(await opfsRecordings(), 'browser')))
  } catch {
    // OPFS indisponivel
  }
  const folder = await getFolder({ requirePermission: true })
  if (folder) {
    try {
      result.push(...(await listDir(folder, 'folder')))
    } catch {
      // sem permissao
    }
  }
  return result.sort((a, b) => b.modified - a.modified)
}

async function dirFor(location: StoredFile['location']) {
  if (location === 'browser') return opfsRecordings()
  const folder = await getFolder({ requirePermission: true })
  if (!folder) throw new Error('Sem acesso a pasta de gravacoes.')
  return folder
}

export async function getStoredFile(file: Pick<StoredFile, 'name' | 'location'>) {
  const dir = await dirFor(file.location)
  return (await dir.getFileHandle(file.name)).getFile()
}

export async function deleteStoredFile(file: Pick<StoredFile, 'name' | 'location'>) {
  const dir = await dirFor(file.location)
  await dir.removeEntry(file.name)
}

/** Move um arquivo que ficou no navegador para a pasta escolhida. */
export async function moveToFolder(file: StoredFile) {
  const folder = await getFolder({ requirePermission: true })
  if (!folder) throw new Error('Escolha e autorize uma pasta primeiro.')
  const source = await (await opfsRecordings()).getFileHandle(file.name)
  const target = await folder.getFileHandle(file.name, { create: true })
  const writable = await target.createWritable()
  await (await source.getFile()).stream().pipeTo(writable)
  await (await opfsRecordings()).removeEntry(file.name)
}

export async function storageEstimate() {
  try {
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

// ---------- notificacoes, wake lock e aviso ao fechar ----------

function notify(title: string, body: string) {
  if (!store.get().settings.notifications || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, icon: '/favicon.svg', tag: `rec-${title}-${body}` })
  } catch {
    // ignore
  }
}

type WakeLockSentinel = { release(): Promise<void>; released: boolean }
let wakeLock: WakeLockSentinel | null = null

async function updateWakeLock() {
  const { settings, rules } = store.get()
  const needed = activeRecordings().length > 0 || (settings.keepAwake && rules.some((rule) => rule.enabled))
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } }
  if (needed && (!wakeLock || wakeLock.released) && nav.wakeLock && document.visibilityState === 'visible') {
    wakeLock = await nav.wakeLock.request('screen').catch(() => null)
  } else if (!needed && wakeLock) {
    await wakeLock.release().catch(() => undefined)
    wakeLock = null
  }
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => void updateWakeLock())
  store.subscribe(() => void updateWakeLock())
  void updateWakeLock()
  window.addEventListener('beforeunload', (event) => {
    if (activeRecordings().length) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
}
