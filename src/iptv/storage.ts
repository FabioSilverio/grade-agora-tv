// Persistencia local: configuracoes leves no localStorage e dados grandes
// (playlists, EPG, handle da pasta de gravacoes) no IndexedDB.

const DB_NAME = 'grade-agora-iptv'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = action(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(request.result as T)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export const idb = {
  get: <T>(key: string) => run<T | undefined>('readonly', (store) => store.get(key)),
  set: (key: string, value: unknown) => run<IDBValidKey>('readwrite', (store) => store.put(value, key)),
  del: (key: string) => run<undefined>('readwrite', (store) => store.delete(key)),
  keys: () => run<IDBValidKey[]>('readonly', (store) => store.getAllKeys()),
}

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota cheia ou storage bloqueado: segue sem persistir
  }
}

export function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
