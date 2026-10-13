import { Loader2, Maximize, PictureInPicture2, TriangleAlert } from 'lucide-react'
import type { PlaylistLoaderConstructor } from 'hls.js'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isProxied, mustProxy, proxify, unproxy, type NetConfig } from '../net'
import { netConfig, useAppState } from '../state'
import type { StreamHeaders } from '../types'

export type PlayerSource = {
  key: string
  title: string
  subtitle?: string
  urls: string[]
  headers?: StreamHeaders
  live: boolean
  /** Forca o motor (ex.: arquivo .ts gravado aberto via blob:). */
  engine?: Engine
}

export type Engine = 'hls' | 'mpegts' | 'native'
type Attempt = { url: string; engine: Engine; viaProxy: boolean }

const START_TIMEOUT_MS = 20_000
const STALL_TIMEOUT_MS = 12_000
const MAX_RETRIES = 8

/** Playlist original -> URL final apos o redirecionamento (token do painel Xtream). */
const stickyPlaylists = new Map<string, string>()

function enginesFor(url: string, live: boolean): Engine[] {
  if (/\.m3u8(\?|$)/i.test(url) || /\/m3u8\b|type=m3u8|output=hls/i.test(url)) return ['hls']
  if (/\.ts(\?|$)/i.test(url)) return ['mpegts', 'hls']
  if (/\.(mp4|m4v|webm|mov|mkv|ogv)(\?|$)/i.test(url)) return ['native']
  return live ? ['mpegts', 'hls'] : ['native', 'hls']
}

function buildAttempts(urls: string[], live: boolean, net: NetConfig, forced?: Engine): Attempt[] {
  const attempts: Attempt[] = []
  for (const url of urls) {
    for (const engine of forced ? [forced] : enginesFor(url, live)) {
      if (!/^https?:/i.test(url)) attempts.push({ url, engine, viaProxy: false })
      else if (mustProxy(url, net)) attempts.push({ url, engine, viaProxy: true })
      else {
        attempts.push({ url, engine, viaProxy: false })
        if (net.mode === 'auto') attempts.push({ url, engine, viaProxy: true })
      }
    }
  }
  return attempts
}

export function Player({ source, actions }: { source: PlayerSource | null; actions?: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const settings = useAppState((state) => state.settings)
  const [status, setStatus] = useState<{ state: 'idle' | 'loading' | 'playing' | 'error'; message?: string }>({ state: 'idle' })

  useEffect(() => {
    const video = videoRef.current
    if (!video || !source) return
    const net = netConfig(settings)
    const attempts = buildAttempts(source.urls, source.live, net, source.engine)
    const errors: string[] = []
    let index = -1
    let cancelled = false
    let cleanup: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const savedVolume = Number(localStorage.getItem('iptv:volume'))
    if (Number.isFinite(savedVolume) && savedVolume > 0) video.volume = Math.min(1, savedVolume)

    let played = false
    let retries = 0
    let stallTimer: ReturnType<typeof setTimeout> | undefined

    const start = (attempt: Attempt) => {
      clearTimeout(timer)
      clearTimeout(stallTimer)
      cleanup?.()
      played = false
      setStatus({
        state: 'loading',
        message: retries ? 'Reconectando...' : attempt.viaProxy ? 'Conectando via proxy...' : 'Conectando...',
      })
      timer = setTimeout(() => onFail('tempo esgotado ao iniciar'), START_TIMEOUT_MS)
      cleanup = startEngine(video, attempt, source, net, (message) => onFail(message))
    }

    const next = () => {
      if (cancelled) return
      index += 1
      retries = 0
      const attempt = attempts[index]
      if (!attempt) {
        cleanup?.()
        cleanup = null
        setStatus({ state: 'error', message: explain(errors) })
        return
      }
      start(attempt)
    }

    const onFail = (reason: string) => {
      if (cancelled) return
      errors.push(reason)
      // Ja estava tocando: e queda momentanea, reconecta a mesma fonte em vez de trocar de formato.
      if ((played || retries > 0) && retries < MAX_RETRIES) {
        retries += 1
        const attempt = attempts[index]
        clearTimeout(timer)
        timer = setTimeout(() => !cancelled && start(attempt), Math.min(5000, 800 * retries))
        return
      }
      next()
    }

    const onPlaying = () => {
      clearTimeout(timer)
      clearTimeout(stallTimer)
      if (!played) {
        played = true
        // 1 min tocando sem erro zera o contador de reconexoes
        setTimeout(() => {
          if (played && !cancelled) retries = 0
        }, 60_000)
      }
      setStatus({ state: 'playing' })
    }
    // Travou (buffer vazio) por muito tempo num ao vivo: reconecta.
    const onWaiting = () => {
      if (!source.live || !played) return
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => onFail('travado sem receber video'), STALL_TIMEOUT_MS)
    }
    const onProgress = () => {
      if (!video.paused && video.readyState >= 3) clearTimeout(stallTimer)
    }
    const onVolume = () => localStorage.setItem('iptv:volume', String(video.muted ? 0 : video.volume))
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('timeupdate', onProgress)
    video.addEventListener('volumechange', onVolume)
    next()

    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(stallTimer)
      cleanup?.()
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('timeupdate', onProgress)
      video.removeEventListener('volumechange', onVolume)
    }
    // source.key identifica a fonte; settings de rede reiniciam o player
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.key, settings.proxyMode, settings.proxyBase, settings.userAgent])

  const fullscreen = () => {
    const element = containerRef.current
    if (!element) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void element.requestFullscreen()
  }

  const pip = () => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) void document.exitPictureInPicture()
    else void video.requestPictureInPicture().catch(() => undefined)
  }

  return (
    <div className="tv-player" ref={containerRef} onDoubleClick={fullscreen}>
      <video ref={videoRef} controls playsInline autoPlay />
      {source && (
        <div className="tv-player-top">
          <div className="tv-player-title">
            <strong>{source.title}</strong>
            {source.subtitle && <span>{source.subtitle}</span>}
          </div>
          <div className="tv-player-actions">
            {actions}
            <button type="button" className="tv-icon-btn" onClick={pip} title="Picture-in-picture">
              <PictureInPicture2 size={18} />
            </button>
            <button type="button" className="tv-icon-btn" onClick={fullscreen} title="Tela cheia (duplo clique)">
              <Maximize size={18} />
            </button>
          </div>
        </div>
      )}
      {!source && <div className="tv-player-msg">Escolha um canal para assistir</div>}
      {source && status.state === 'loading' && (
        <div className="tv-player-msg">
          <Loader2 className="tv-spin" size={28} />
          <span>{status.message}</span>
        </div>
      )}
      {source && status.state === 'error' && (
        <div className="tv-player-msg error">
          <TriangleAlert size={28} />
          <span>{status.message}</span>
        </div>
      )}
    </div>
  )
}

function explain(errors: string[]) {
  const text = errors.join(' | ')
  if (/codec|incompatible/i.test(text)) {
    return 'O navegador nao suporta o audio/video deste canal (comum com audio AC-3/Dolby). Tente o Microsoft Edge ou grave e abra no VLC.'
  }
  if (/403|401|forbidden/i.test(text)) return `O servidor recusou o acesso (limite de conexoes ou login expirado). ${errors[errors.length - 1] ?? ''}`
  return `Nao foi possivel reproduzir este canal. ${errors.slice(-2).join(' | ')}`
}

function startEngine(video: HTMLVideoElement, attempt: Attempt, source: PlayerSource, net: NetConfig, fail: (message: string) => void) {
  const play = () => void video.play().catch(() => undefined)

  // hls.js e mpegts.js sao carregados sob demanda (deixam o bundle inicial bem menor).
  let disposed = false
  let destroy: () => void = () => undefined
  const load = async () => {
    if (attempt.engine === 'hls') {
      const { default: Hls } = await import('hls.js')
      if (disposed) return
      if (!Hls.isSupported()) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) destroy = startNative(video, attempt, source, net, fail)
        else fail('HLS nao suportado')
        return
      }
      // Paineis Xtream redirecionam /live/.../id.m3u8 para uma URL com token. Recarregar a
      // playlist pela URL original gera um token novo a cada poucos segundos e, em contas com
      // 1 conexao, derruba o token anterior (video trava). Entao as recargas usam a URL final.
      const BaseLoader = Hls.DefaultConfig.loader
      class StickyPlaylistLoader extends BaseLoader {
        load(...args: Parameters<InstanceType<typeof BaseLoader>['load']>) {
          const [context, config, callbacks] = args
          const original = unproxy(context.url, net)
          if (attempt.viaProxy) context.url = original
          const sticky = stickyPlaylists.get(original)
          if (sticky) context.url = sticky
          super.load(context, config, {
            ...callbacks,
            onSuccess: (response, stats, ctx, details) => {
              const xhr = details as XMLHttpRequest | undefined
              const final =
                xhr?.getResponseHeader?.('X-Final-Url') || (xhr?.responseURL && !isProxied(xhr.responseURL, net) ? xhr.responseURL : '')
              if (final && final !== original) stickyPlaylists.set(original, final)
              callbacks.onSuccess(response, stats, ctx, details)
            },
            onError: (error, ctx, details, stats) => {
              stickyPlaylists.delete(original)
              callbacks.onError(error, ctx, details, stats)
            },
            onTimeout: (stats, ctx, details) => {
              stickyPlaylists.delete(original)
              callbacks.onTimeout(stats, ctx, details)
            },
          })
        }
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        pLoader: StickyPlaylistLoader as unknown as PlaylistLoaderConstructor,
        backBufferLength: source.live ? 30 : 90,
        maxBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        xhrSetup: attempt.viaProxy
          ? (xhr, url) => {
              if (!url.startsWith(new URL(net.base, location.href).href)) xhr.open('GET', proxify(url, net, source.headers), true)
            }
          : undefined,
      })
      let mediaRecovered = false
      hls.on(Hls.Events.MANIFEST_PARSED, play)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true
          hls.recoverMediaError()
          return
        }
        const code = data.response?.code ? ` HTTP ${data.response.code}` : ''
        fail(`hls: ${data.details}${code}`)
      })
      hls.loadSource(attempt.url)
      hls.attachMedia(video)
      destroy = () => hls.destroy()
      return
    }

    const { default: mpegts } = await import('mpegts.js')
    if (disposed) return
    if (!mpegts.getFeatureList().mseLivePlayback) {
      fail('MPEG-TS nao suportado neste navegador')
      return
    }
    const url = attempt.viaProxy ? proxify(attempt.url, net, source.headers) : attempt.url
    const player = mpegts.createPlayer(
      { type: 'mpegts', isLive: source.live, url },
      {
        enableWorker: true,
        // buffer de entrada absorve as oscilacoes da rede/proxy
        enableStashBuffer: true,
        stashInitialSize: 512 * 1024,
        // sem "pular" para o ao vivo (causava engasgos); acelera de leve se atrasar demais
        liveBufferLatencyChasing: false,
        liveSync: source.live,
        liveSyncMaxLatency: 20,
        liveSyncTargetLatency: 10,
        liveSyncPlaybackRate: 1.05,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
      },
    )
    player.on(mpegts.Events.ERROR, (type: string, detail: string) => fail(`mpegts: ${type} ${detail}`))
    player.attachMediaElement(video)
    player.load()
    play()
    destroy = () => {
      try {
        player.pause()
        player.unload()
        player.detachMediaElement()
        player.destroy()
      } catch {
        // ignore
      }
    }
  }

  if (attempt.engine !== 'native') {
    load().catch((error) => !disposed && fail(`falha ao carregar o player: ${error instanceof Error ? error.message : error}`))
    return () => {
      disposed = true
      destroy()
    }
  }

  return startNative(video, attempt, source, net, fail)
}

function startNative(video: HTMLVideoElement, attempt: Attempt, source: PlayerSource, net: NetConfig, fail: (message: string) => void) {
  const onError = () => fail(`video: ${video.error?.message || `erro ${video.error?.code ?? ''}`}`)
  video.addEventListener('error', onError)
  video.src = attempt.viaProxy ? proxify(attempt.url, net, source.headers) : attempt.url
  void video.play().catch(() => undefined)
  return () => {
    video.removeEventListener('error', onError)
    video.removeAttribute('src')
    video.load()
  }
}
