import { CalendarPlus, Circle, CircleStop, Clock, RefreshCw, Repeat, Search, Star, Tv } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { currentProgramme, reloadEpg, useEpgStatus, useProgrammes } from '../epg'
import { channelCandidates } from '../playlists'
import { useActiveRecordings } from '../activeRecordings'
import { localRecordNow, localStop, useLocalService } from '../localService'
import { startRecording, stopRecording } from '../recorder'
import { store, useAppState } from '../state'
import { uid } from '../storage'
import type { Channel, PlaylistData, Programme } from '../types'
import { fmtDay, fmtTime, toChannelRef } from '../format'
import { useNow } from '../hooks'
import { Empty, Logo, VirtualList } from '../ui'
import { Player, type PlayerSource } from './Player'
import { openRuleEditor, seriesDraftFromProgramme } from '../ruleDraft'

const FAVORITES = '★ Favoritos'
const ALL = 'Todos os canais'

export function LiveView({
  playlistId,
  data,
  channelId,
  onChannel,
}: {
  playlistId: string
  data: PlaylistData
  channelId: string | null
  onChannel: (id: string) => void
}) {
  const favorites = useAppState((state) => state.favorites[playlistId])
  const [group, setGroup] = useState(() => localStorage.getItem(`iptv:group:${playlistId}`) || ALL)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const channel of data.channels) counts.set(channel.group, (counts.get(channel.group) ?? 0) + 1)
    return [...counts.entries()]
  }, [data.channels])

  const favoriteSet = useMemo(() => new Set(favorites ?? []), [favorites])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return data.channels.filter((channel) => {
      if (term) return channel.name.toLowerCase().includes(term)
      if (group === FAVORITES) return favoriteSet.has(channel.id)
      if (group === ALL) return true
      return channel.group === group
    })
  }, [data.channels, group, query, favoriteSet])

  const channel = data.channels.find((item) => item.id === channelId) ?? null

  const zap = useCallback(
    (delta: number) => {
      if (!visible.length) return
      const index = visible.findIndex((item) => item.id === channelId)
      const next = visible[(index + delta + visible.length) % visible.length]
      onChannel(next.id)
    },
    [visible, channelId, onChannel],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.key === 'PageUp' || (event.key === 'ArrowUp' && event.ctrlKey)) {
        event.preventDefault()
        zap(-1)
      }
      if (event.key === 'PageDown' || (event.key === 'ArrowDown' && event.ctrlKey)) {
        event.preventDefault()
        zap(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zap])

  const chooseGroup = (value: string) => {
    setGroup(value)
    localStorage.setItem(`iptv:group:${playlistId}`, value)
  }

  const toggleFavorite = (id: string) => {
    store.set((state) => {
      const current = new Set(state.favorites[playlistId] ?? [])
      if (current.has(id)) current.delete(id)
      else current.add(id)
      return { favorites: { ...state.favorites, [playlistId]: [...current] } }
    })
  }

  const config = useAppState((state) => state.playlists.find((item) => item.id === playlistId))
  const showNowInList = config?.epgMode === 'provider-xmltv' || config?.epgMode === 'custom'

  return (
    <div className="tv-live">
      <aside className="tv-sidebar">
        <label className="tv-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar em ${data.channels.length} canais`} />
        </label>
        <select className="tv-group-select" value={group} onChange={(event) => chooseGroup(event.target.value)} disabled={Boolean(query)}>
          <option value={ALL}>
            {ALL} ({data.channels.length})
          </option>
          <option value={FAVORITES}>
            {FAVORITES} ({favoriteSet.size})
          </option>
          {groups.map(([name, count]) => (
            <option key={name} value={name}>
              {name} ({count})
            </option>
          ))}
        </select>
        {visible.length ? (
          <VirtualList
            className="tv-channel-list"
            items={visible}
            rowHeight={56}
            scrollToIndex={visible.findIndex((item) => item.id === channelId)}
            render={(item) => (
              <ChannelRow
                playlistId={playlistId}
                channel={item}
                active={item.id === channelId}
                favorite={favoriteSet.has(item.id)}
                showNow={showNowInList}
                onSelect={() => onChannel(item.id)}
                onFavorite={() => toggleFavorite(item.id)}
              />
            )}
          />
        ) : (
          <Empty title={group === FAVORITES ? 'Sem favoritos ainda' : 'Nenhum canal'}>
            {group === FAVORITES && <p>Clique na estrela ao lado de um canal para fixar aqui.</p>}
          </Empty>
        )}
      </aside>

      <section className="tv-main">
        <LivePlayer playlistId={playlistId} channel={channel} />
        {channel ? (
          <EpgPanel playlistId={playlistId} channel={channel} />
        ) : (
          <Empty icon={<Tv size={32} />} title="Escolha um canal na lista">
            <p>Use PageUp/PageDown (ou Ctrl+setas) para trocar de canal. Duplo clique no video = tela cheia.</p>
          </Empty>
        )}
      </section>
    </div>
  )
}

function ChannelRow({
  playlistId,
  channel,
  active,
  favorite,
  showNow,
  onSelect,
  onFavorite,
}: {
  playlistId: string
  channel: Channel
  active: boolean
  favorite: boolean
  showNow: boolean
  onSelect: () => void
  onFavorite: () => void
}) {
  const { list } = useProgrammes(showNow ? playlistId : null, showNow ? channel : null)
  const now = currentProgramme(list)
  return (
    <div className={active ? 'tv-channel active' : 'tv-channel'} onClick={onSelect} role="button" tabIndex={0}>
      {channel.num != null && <span className="tv-channel-num">{channel.num}</span>}
      <Logo src={channel.logo} name={channel.name} />
      <span className="tv-channel-text">
        <strong>{channel.name}</strong>
        <small>{now ? `${fmtTime(now.start)} ${now.title}` : channel.group}</small>
      </span>
      <button
        type="button"
        className={favorite ? 'tv-fav on' : 'tv-fav'}
        onClick={(event) => {
          event.stopPropagation()
          onFavorite()
        }}
        aria-label="Favorito"
      >
        <Star size={15} />
      </button>
    </div>
  )
}

function LivePlayer({ playlistId, channel }: { playlistId: string; channel: Channel | null }) {
  const { list } = useProgrammes(channel ? playlistId : null, channel)
  const now = useNow()
  const current = currentProgramme(list, now)
  const source: PlayerSource | null = channel
    ? {
        key: `${playlistId}:${channel.id}`,
        title: channel.name,
        subtitle: current ? `${fmtTime(current.start)}–${fmtTime(current.stop)} ${current.title}` : channel.group,
        urls: channelCandidates(channel),
        headers: channel.headers,
        live: true,
      }
    : null
  return <Player source={source} actions={channel && <RecordNowButton playlistId={playlistId} channel={channel} current={current} />} />
}

function RecordNowButton({ playlistId, channel, current }: { playlistId: string; channel: Channel; current?: Programme }) {
  const recordings = useActiveRecordings()
  const local = useLocalService()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const active = recordings.find((item) => item.channelName === channel.name)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if (active) {
    return (
      <button
        type="button"
        className="tv-rec-btn on"
        onClick={() => (active.where === 'pc' ? void localStop(active.id) : stopRecording(active.id))}
        title="Parar gravacao"
      >
        <CircleStop size={16} /> Gravando · parar
      </button>
    )
  }

  const record = (stopAt: number, title?: string) => {
    setOpen(false)
    const ref = toChannelRef(playlistId, channel)
    const name = title ?? current?.title ?? channel.name
    // Com o gravador do PC ligado, grava por ele (continua mesmo se fechar o site).
    if (local.available) {
      localRecordNow(ref, name, stopAt).catch((err) => setError(err instanceof Error ? err.message : String(err)))
      return
    }
    void startRecording({ channel: ref, title: name, stopAt, occurrenceKey: uid('manual') })
  }
  const padAfter = store.get().settings.padAfterMin * 60_000

  return (
    <div className="tv-dropdown" ref={ref}>
      <button
        type="button"
        className="tv-rec-btn"
        onClick={() => setOpen((value) => !value)}
        title={error ? `Erro: ${error}` : local.available ? 'Gravar agora (no gravador do PC)' : 'Gravar agora'}
      >
        <Circle size={14} fill="currentColor" /> Gravar
      </button>
      {open && (
        <div className="tv-menu">
          {current && (
            <button type="button" onClick={() => record(current.stop + padAfter, current.title)}>
              Ate o fim de “{current.title}” ({fmtTime(current.stop + padAfter)})
            </button>
          )}
          {[30, 60, 120, 180].map((minutes) => (
            <button key={minutes} type="button" onClick={() => record(Date.now() + minutes * 60_000)}>
              Por {minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}
            </button>
          ))}
          <button type="button" onClick={() => record(Date.now() + 12 * 3_600_000)}>
            Ate eu parar (max. 12 h)
          </button>
        </div>
      )}
    </div>
  )
}

function EpgPanel({ playlistId, channel }: { playlistId: string; channel: Channel }) {
  const { list, loading } = useProgrammes(playlistId, channel)
  const status = useEpgStatus(playlistId)
  const now = useNow()
  const rules = useAppState((state) => state.rules)
  const listRef = useRef<HTMLDivElement>(null)

  const upcoming = useMemo(() => list.filter((item) => item.stop > now - 3 * 3_600_000), [list, now])
  const ref = toChannelRef(playlistId, channel)
  const channelRules = rules.filter((rule) => rule.channel.playlistId === playlistId && rule.channel.channelId === channel.id)

  useEffect(() => {
    const element = listRef.current?.querySelector('.tv-prog.now')
    element?.scrollIntoView({ block: 'nearest' })
  }, [list])

  const scheduleOnce = (programme: Programme) => {
    store.set((state) => ({
      rules: [
        ...state.rules,
        {
          id: uid('rule'),
          kind: 'once',
          enabled: true,
          channel: ref,
          title: programme.title,
          match: 'exact',
          days: [],
          toleranceMin: 0,
          fallbackToTime: false,
          padBeforeMin: state.settings.padBeforeMin,
          padAfterMin: state.settings.padAfterMin,
          start: programme.start,
          stop: programme.stop,
          createdAt: Date.now(),
        },
      ],
    }))
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission()
  }

  const isScheduled = (programme: Programme) =>
    channelRules.some((rule) => rule.kind === 'once' && rule.start === programme.start)

  return (
    <div className="tv-epg-panel">
      <header>
        <div>
          <h3>Programacao · {channel.name}</h3>
          <small className="tv-muted">
            {loading ? 'Carregando EPG...' : status.state === 'loading' ? status.message : list.length ? `${list.length} programas na EPG` : 'Sem EPG para este canal'}
          </small>
        </div>
        <div className="tv-actions">
          <button
            type="button"
            className="tv-btn ghost small"
            onClick={() => openRuleEditor({ kind: 'daily', channel: ref, title: '' })}
            title="Agendar por horario fixo"
          >
            <Clock size={15} /> Horario fixo
          </button>
          <button type="button" className="tv-btn ghost small" onClick={() => reloadEpg(playlistId)} title="Recarregar EPG">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {!loading && !upcoming.length && (
        <p className="tv-muted tv-pad">
          Este canal nao tem EPG. Ajuste a fonte de EPG da playlist (botao de playlists) ou use “Horario fixo” para gravar todo dia no
          mesmo horario.
        </p>
      )}

      <div className="tv-prog-list" ref={listRef}>
        {upcoming.map((programme, index) => {
          const live = programme.start <= now && programme.stop > now
          const past = programme.stop <= now
          const showDay = index === 0 || fmtDay(upcoming[index - 1].start) !== fmtDay(programme.start)
          const progress = live ? ((now - programme.start) / (programme.stop - programme.start)) * 100 : 0
          const seriesRule = channelRules.find(
            (rule) => rule.kind === 'series' && programme.title.toLowerCase().includes(rule.title.toLowerCase()),
          )
          return (
            <div key={`${programme.start}-${programme.title}`}>
              {showDay && <div className="tv-day-sep">{fmtDay(programme.start)}</div>}
              <div className={`tv-prog${live ? ' now' : ''}${past ? ' past' : ''}`}>
                <span className="tv-prog-time">
                  {fmtTime(programme.start)}
                  <small>{fmtTime(programme.stop)}</small>
                </span>
                <span className="tv-prog-body">
                  <strong>
                    {programme.title}
                    {live && <em className="tv-live-tag">AO VIVO</em>}
                    {seriesRule && <em className="tv-tag">todo dia</em>}
                  </strong>
                  {programme.desc && <small>{programme.desc}</small>}
                  {live && (
                    <span className="tv-progress">
                      <span style={{ width: `${progress}%` }} />
                    </span>
                  )}
                </span>
                {!past && (
                  <span className="tv-prog-actions">
                    {!live && (
                      <button
                        type="button"
                        className={isScheduled(programme) ? 'tv-btn small on' : 'tv-btn small'}
                        disabled={isScheduled(programme)}
                        onClick={() => scheduleOnce(programme)}
                        title="Gravar esta exibicao"
                      >
                        <CalendarPlus size={14} /> {isScheduled(programme) ? 'Agendado' : 'Gravar'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="tv-btn small"
                      onClick={() => openRuleEditor(seriesDraftFromProgramme(ref, programme))}
                      title="Gravar este programa todo dia no horario dele"
                    >
                      <Repeat size={14} /> Todo dia
                    </button>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
