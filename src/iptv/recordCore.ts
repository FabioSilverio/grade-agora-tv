// Motor de gravacao compartilhado pelo navegador (Web Worker) e pelo gravador do PC
// (servico Node). Baixa o stream sem recodificar: HLS segmento a segmento ou MPEG-TS
// continuo, reconectando sozinho ate o horario de termino.

import { decryptSegment, parseHls, type HlsSegment, type MediaPlaylist } from './hls'
import type { RecordingStatus } from './types'

export type CoreFetch = (url: string, signal: AbortSignal) => Promise<{ response: Response; finalUrl: string }>

export type RecorderOptions = {
  urls: string[]
  hlsQuality: 'best' | 'lowest'
  fetch: CoreFetch
  /** Recebe os bytes na ordem; o primeiro pedaco define o formato (ver detectFormat). */
  write: (data: Uint8Array) => Promise<void>
  onStatus: (status: RecordingStatus, message?: string) => void
  getStopAt: () => number
}

export function detectFormat(bytes: Uint8Array): 'ts' | 'mp4' {
  const box = String.fromCharCode(...bytes.slice(4, 8))
  if (['ftyp', 'styp', 'moof', 'moov', 'sidx'].includes(box)) return 'mp4'
  return 'ts'
}

export class StreamRecorder {
  bytes = 0
  stopped = false
  private options: RecorderOptions
  private controller = new AbortController()
  private wake?: () => void
  private lastSeq = -1
  private lastMap?: string
  private keys = new Map<string, ArrayBuffer>()

  constructor(options: RecorderOptions) {
    this.options = options
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.controller.abort()
    this.wake?.()
  }

  /** Acorda esperas (ex.: horario de termino mudou). */
  poke() {
    this.wake?.()
  }

  private expired() {
    return this.stopped || Date.now() >= this.options.getStopAt()
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.wake = undefined
        resolve()
      }
      const timer = setTimeout(done, ms)
      this.wake = done
    })
  }

  async run() {
    const { urls, onStatus } = this.options
    onStatus('starting')
    // Encerra no horario mesmo se estiver no meio de um download.
    const watchdog = setInterval(() => {
      if (!this.stopped && Date.now() >= this.options.getStopAt()) this.stop()
    }, 1000)

    let failures = 0
    let urlIndex = 0
    try {
      while (!this.expired()) {
        const url = urls[urlIndex % urls.length]
        const before = this.bytes
        try {
          await this.recordFrom(url)
          if (!this.expired()) onStatus('reconnecting', 'O servidor encerrou a conexao, reconectando...')
        } catch (error) {
          if (this.expired()) break
          const message = error instanceof Error ? error.message : String(error)
          onStatus('reconnecting', `Falha: ${message}. Tentando de novo...`)
        }
        if (this.expired()) break
        failures = this.bytes > before ? 0 : failures + 1
        // Depois de 2 falhas seguidas na mesma URL, tenta a alternativa (.m3u8 <-> .ts).
        if (failures > 0 && failures % 2 === 0) urlIndex += 1
        this.controller = new AbortController()
        await this.sleep(Math.min(15_000, 1000 + failures * 2000))
      }
    } finally {
      clearInterval(watchdog)
    }
  }

  private async get(url: string) {
    const result = await this.options.fetch(url, this.controller.signal)
    if (!result.response.ok) throw new Error(`HTTP ${result.response.status}`)
    return result
  }

  private async recordFrom(url: string) {
    const { response, finalUrl } = await this.get(url)
    if (!response.body) throw new Error('resposta vazia')
    const reader = response.body.getReader()
    const first = await reader.read()
    if (first.done || !first.value) throw new Error('stream vazio')

    const head = new TextDecoder().decode(first.value.slice(0, 16)).trimStart()
    if (head.startsWith('#EXTM3U')) {
      const decoder = new TextDecoder()
      let text = decoder.decode(first.value, { stream: true })
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
      }
      await this.recordHls(url, text, finalUrl)
      return
    }

    this.options.onStatus('recording')
    await this.write(first.value)
    for (;;) {
      const { done, value } = await reader.read()
      if (done || this.stopped) break
      await this.write(value)
    }
  }

  private async recordHls(requestUrl: string, text: string, baseUrl: string) {
    // Recarrega pela URL final (com token) para nao abrir uma sessao nova a cada recarga;
    // se o token expirar, volta para a URL original.
    let originalUrl = requestUrl
    let stickyUrl: string | null = baseUrl !== requestUrl ? baseUrl : null
    let parsed = parseHls(text, baseUrl)
    if (parsed.kind === 'master') {
      const variants = [...parsed.variants].sort((a, b) => a.bandwidth - b.bandwidth)
      const variant = this.options.hlsQuality === 'lowest' ? variants[0] : variants[variants.length - 1]
      if (!variant) throw new Error('playlist HLS sem variantes')
      originalUrl = variant.uri
      stickyUrl = null
      const loaded = await this.loadMedia(originalUrl)
      parsed = loaded.playlist
      if (loaded.finalUrl !== originalUrl) stickyUrl = loaded.finalUrl
    }

    this.options.onStatus('recording')
    let playlist = parsed as MediaPlaylist
    let stale = 0
    while (!this.stopped) {
      const segments = playlist.segments
      const newest = segments[segments.length - 1]
      let pending: HlsSegment[]
      if (this.lastSeq < 0 || (newest && newest.seq < this.lastSeq - 10)) {
        // inicio (ou stream reiniciado): comeca perto do ao vivo
        pending = segments.slice(-3)
      } else {
        pending = segments.filter((segment) => segment.seq > this.lastSeq)
      }

      for (const segment of pending) {
        if (this.stopped) return
        if (segment.map && segment.map !== this.lastMap) {
          await this.write(new Uint8Array(await this.fetchBytes(segment.map)))
          this.lastMap = segment.map
        }
        let data = await this.fetchBytes(segment.uri)
        if (segment.key?.method === 'AES-128' && segment.key.uri) {
          let key = this.keys.get(segment.key.uri)
          if (!key) {
            key = await this.fetchBytes(segment.key.uri)
            this.keys.set(segment.key.uri, key)
          }
          data = await decryptSegment(data, key, segment.key, segment.seq)
        }
        await this.write(new Uint8Array(data))
        this.lastSeq = segment.seq
      }

      if (playlist.endList) return
      stale = pending.length ? 0 : stale + 1
      if (stale > 20) throw new Error('playlist HLS parou de atualizar')
      await this.sleep(Math.min(6000, Math.max(1000, (playlist.targetDuration * 1000) / 2)))
      if (this.stopped) return

      let loaded: { playlist: MediaPlaylist; finalUrl: string } | null = null
      if (stickyUrl) {
        loaded = await this.loadMedia(stickyUrl).catch(() => null)
        if (!loaded) stickyUrl = null
      }
      if (!loaded) {
        loaded = await this.loadMedia(originalUrl)
        if (loaded.finalUrl !== originalUrl) stickyUrl = loaded.finalUrl
      }
      playlist = loaded.playlist
    }
  }

  private async loadMedia(url: string) {
    const { response, finalUrl } = await this.get(url)
    const parsed = parseHls(await response.text(), finalUrl)
    if (parsed.kind !== 'media') throw new Error('playlist HLS inesperada')
    return { playlist: parsed, finalUrl }
  }

  private async fetchBytes(url: string) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const { response } = await this.get(url)
        return await response.arrayBuffer()
      } catch (error) {
        if (this.stopped || attempt >= 2) throw error
        await this.sleep(800)
      }
    }
  }

  private async write(data: Uint8Array) {
    if (!data.byteLength) return
    await this.options.write(data)
    this.bytes += data.byteLength
  }
}
