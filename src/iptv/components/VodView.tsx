import { Film, Loader2, Play, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { xtreamClient } from '../playlists'
import { getPlaylist } from '../state'
import type { PlaylistData, SeriesItem, VodItem } from '../types'
import type { SeriesInfo } from '../xtream'
import { Empty, Modal } from '../ui'
import { Player, type PlayerSource } from './Player'

const PAGE = 120

type Item = { id: string; name: string; image?: string; group: string; meta?: string }

function useBrowser(items: Item[]) {
  const [group, setGroup] = useState<string>('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.group, (counts.get(item.group) ?? 0) + 1)
    return [...counts.entries()]
  }, [items])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return items.filter((item) => (term ? item.name.toLowerCase().includes(term) : !group || item.group === group))
  }, [items, group, query])
  return {
    group,
    setGroup: (value: string) => {
      setGroup(value)
      setLimit(PAGE)
    },
    query,
    setQuery: (value: string) => {
      setQuery(value)
      setLimit(PAGE)
    },
    groups,
    filtered,
    limit,
    more: () => setLimit((value) => value + PAGE),
  }
}

function Browser({ items, onOpen, kind }: { items: Item[]; onOpen: (id: string) => void; kind: string }) {
  const browser = useBrowser(items)
  if (!items.length) {
    return (
      <Empty icon={<Film size={32} />} title={`Nenhum(a) ${kind} nesta playlist`}>
        <p>Listas M3U so trazem filmes quando incluem links /movie/ ou arquivos .mp4/.mkv.</p>
      </Empty>
    )
  }
  return (
    <div className="tv-vod">
      <aside className="tv-vod-groups">
        <button type="button" className={!browser.group ? 'active' : ''} onClick={() => browser.setGroup('')}>
          Todos <small>{items.length}</small>
        </button>
        {browser.groups.map(([name, count]) => (
          <button key={name} type="button" className={browser.group === name ? 'active' : ''} onClick={() => browser.setGroup(name)}>
            {name} <small>{count}</small>
          </button>
        ))}
      </aside>
      <section className="tv-vod-main">
        <label className="tv-search">
          <Search size={16} />
          <input value={browser.query} onChange={(event) => browser.setQuery(event.target.value)} placeholder={`Buscar ${kind}...`} />
        </label>
        <div className="tv-poster-grid">
          {browser.filtered.slice(0, browser.limit).map((item) => (
            <button key={item.id} type="button" className="tv-poster" onClick={() => onOpen(item.id)}>
              <span className="tv-poster-img">
                {item.image ? <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Film size={28} />}
              </span>
              <strong>{item.name}</strong>
              {item.meta && <small>{item.meta}</small>}
            </button>
          ))}
        </div>
        {browser.filtered.length > browser.limit && (
          <button type="button" className="tv-btn ghost tv-more" onClick={browser.more}>
            Mostrar mais ({browser.filtered.length - browser.limit} restantes)
          </button>
        )}
      </section>
    </div>
  )
}

export function MoviesView({ data }: { data: PlaylistData }) {
  const [playing, setPlaying] = useState<VodItem | null>(null)
  const items = useMemo<Item[]>(
    () =>
      data.movies.map((movie) => ({
        id: movie.id,
        name: movie.name,
        image: movie.logo,
        group: movie.group,
        meta: [movie.year, movie.rating && `★ ${movie.rating}`].filter(Boolean).join(' · '),
      })),
    [data.movies],
  )
  return (
    <>
      <Browser items={items} kind="filme" onOpen={(id) => setPlaying(data.movies.find((movie) => movie.id === id) ?? null)} />
      {playing?.url && (
        <PlayerModal
          onClose={() => setPlaying(null)}
          source={{ key: `movie:${playing.id}`, title: playing.name, urls: [playing.url], headers: playing.headers, live: false }}
        />
      )}
    </>
  )
}

export function SeriesView({ playlistId, data }: { playlistId: string; data: PlaylistData }) {
  const [open, setOpen] = useState<SeriesItem | null>(null)
  const items = useMemo<Item[]>(
    () =>
      data.series.map((series) => ({
        id: series.id,
        name: series.name,
        image: series.cover,
        group: series.group,
        meta: series.rating ? `★ ${series.rating}` : undefined,
      })),
    [data.series],
  )
  return (
    <>
      <Browser items={items} kind="serie" onOpen={(id) => setOpen(data.series.find((series) => series.id === id) ?? null)} />
      {open && <SeriesModal playlistId={playlistId} series={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function SeriesModal({ playlistId, series, onClose }: { playlistId: string; series: SeriesItem; onClose: () => void }) {
  const [info, setInfo] = useState<SeriesInfo | null>(null)
  const [error, setError] = useState('')
  const [season, setSeason] = useState<string>('')
  const [playing, setPlaying] = useState<PlayerSource | null>(null)
  const config = getPlaylist(playlistId)
  const client = config ? xtreamClient(config) : null

  useEffect(() => {
    if (!client) return
    const controller = new AbortController()
    client
      .seriesInfo(series.seriesId, controller.signal)
      .then((result) => {
        setInfo(result)
        setSeason(Object.keys(result.episodes ?? {})[0] ?? '')
      })
      .catch((err) => !controller.signal.aborted && setError(err instanceof Error ? err.message : String(err)))
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.seriesId, playlistId])

  const seasons = Object.keys(info?.episodes ?? {})
  const episodes = info?.episodes?.[season] ?? []

  return (
    <Modal title={series.name} onClose={onClose} wide>
      {playing ? (
        <div className="tv-modal-player">
          <Player source={playing} />
          <button type="button" className="tv-btn ghost" onClick={() => setPlaying(null)}>
            Voltar aos episodios
          </button>
        </div>
      ) : (
        <>
          {(info?.info?.plot || series.plot) && <p className="tv-muted">{info?.info?.plot || series.plot}</p>}
          {error && <p className="tv-error">{error}</p>}
          {!info && !error && (
            <p className="tv-muted">
              <Loader2 className="tv-spin" size={16} /> Carregando episodios...
            </p>
          )}
          {seasons.length > 0 && (
            <div className="tv-segmented wrap">
              {seasons.map((key) => (
                <button key={key} type="button" className={key === season ? 'active' : ''} onClick={() => setSeason(key)}>
                  Temporada {key}
                </button>
              ))}
            </div>
          )}
          <div className="tv-episodes">
            {episodes.map((episode) => (
              <button
                key={episode.id}
                type="button"
                className="tv-episode"
                onClick={() =>
                  client &&
                  setPlaying({
                    key: `ep:${episode.id}`,
                    title: `${series.name} · T${season}E${episode.episode_num}`,
                    subtitle: episode.title,
                    urls: [client.episodeUrl(episode.id, episode.container_extension || 'mp4')],
                    live: false,
                  })
                }
              >
                <Play size={14} />
                <span>
                  <strong>
                    {episode.episode_num}. {episode.title}
                  </strong>
                  {episode.info?.plot && <small>{episode.info.plot}</small>}
                </span>
                {episode.info?.duration && <small>{episode.info.duration}</small>}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

export function PlayerModal({ source, onClose }: { source: PlayerSource; onClose: () => void }) {
  return (
    <Modal title={source.title} onClose={onClose} wide>
      <div className="tv-modal-player">
        <Player source={source} />
      </div>
    </Modal>
  )
}
