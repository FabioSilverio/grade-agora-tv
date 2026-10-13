import { CalendarPlus, Play, Repeat } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useProgrammes } from '../epg'
import { store, useAppState } from '../state'
import { uid } from '../storage'
import type { Channel, PlaylistData, Programme } from '../types'
import { fmtDateTime, fmtTime, toChannelRef } from '../format'
import { useNow } from '../hooks'
import { Empty, Logo, Modal } from '../ui'
import { openRuleEditor, seriesDraftFromProgramme } from '../ruleDraft'

const PX_PER_MIN = 5
const SPAN_HOURS = 24
const MAX_ROWS = 300

export function GuideView({ playlistId, data, onWatch }: { playlistId: string; data: PlaylistData; onWatch: (id: string) => void }) {
  const favorites = useAppState((state) => state.favorites[playlistId])
  const groups = useMemo(() => [...new Set(data.channels.map((channel) => channel.group))], [data.channels])
  const [group, setGroup] = useState(() => {
    const saved = localStorage.getItem(`iptv:group:${playlistId}`)
    return saved && (groups.includes(saved) || saved.startsWith('★')) ? saved : (groups[0] ?? '')
  })
  const now = useNow(60_000)
  const [origin] = useState(() => {
    const date = new Date()
    date.setMinutes(date.getMinutes() < 30 ? 0 : 30, 0, 0)
    return date.getTime() - 60 * 60_000
  })
  const [selected, setSelected] = useState<{ channel: Channel; programme: Programme } | null>(null)

  const channels = useMemo(() => {
    if (group.startsWith('★')) {
      const set = new Set(favorites ?? [])
      return data.channels.filter((channel) => set.has(channel.id))
    }
    return data.channels.filter((channel) => channel.group === group)
  }, [data.channels, group, favorites])

  const width = SPAN_HOURS * 60 * PX_PER_MIN
  const hours = Array.from({ length: SPAN_HOURS * 2 }, (_, index) => origin + index * 30 * 60_000)
  const nowLeft = ((now - origin) / 60_000) * PX_PER_MIN

  return (
    <div className="tv-guide">
      <div className="tv-guide-bar">
        <select value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="★ Favoritos">★ Favoritos</option>
          {groups.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="tv-muted">{channels.length} canais · role para os lados para ver mais horarios</span>
      </div>

      {!channels.length ? (
        <Empty title="Nenhum canal neste grupo" />
      ) : (
        <div className="tv-guide-scroll">
          <div className="tv-guide-head" style={{ width: width + 220 }}>
            <div className="tv-guide-corner">Canal</div>
            <div className="tv-guide-times" style={{ width }}>
              {hours.map((slot) => (
                <span key={slot} style={{ left: ((slot - origin) / 60_000) * PX_PER_MIN }}>
                  {fmtTime(slot)}
                </span>
              ))}
            </div>
          </div>
          {channels.slice(0, MAX_ROWS).map((channel) => (
            <GuideRow
              key={channel.id}
              playlistId={playlistId}
              channel={channel}
              origin={origin}
              width={width}
              nowLeft={nowLeft}
              now={now}
              onWatch={() => onWatch(channel.id)}
              onSelect={(programme) => setSelected({ channel, programme })}
            />
          ))}
          {channels.length > MAX_ROWS && <p className="tv-muted tv-pad">Mostrando os primeiros {MAX_ROWS} canais do grupo.</p>}
        </div>
      )}

      {selected && (
        <ProgrammeModal
          playlistId={playlistId}
          channel={selected.channel}
          programme={selected.programme}
          onClose={() => setSelected(null)}
          onWatch={() => onWatch(selected.channel.id)}
        />
      )}
    </div>
  )
}

function GuideRow({
  playlistId,
  channel,
  origin,
  width,
  nowLeft,
  now,
  onWatch,
  onSelect,
}: {
  playlistId: string
  channel: Channel
  origin: number
  width: number
  nowLeft: number
  now: number
  onWatch: () => void
  onSelect: (programme: Programme) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = rowRef.current
    if (!element || seen) return
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setSeen(true), {
      rootMargin: '200px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])
  // So consulta a EPG quando a linha aparece na tela.
  const { list, loading } = useProgrammes(seen ? playlistId : null, seen ? channel : null)
  const end = origin + (width / PX_PER_MIN) * 60_000
  const visible = list.filter((item) => item.stop > origin && item.start < end)
  return (
    <div className="tv-guide-row" ref={rowRef}>
      <button type="button" className="tv-guide-channel" onClick={onWatch} title="Assistir">
        <Logo src={channel.logo} name={channel.name} size={30} />
        <span>{channel.name}</span>
      </button>
      <div className="tv-guide-track" style={{ width }}>
        <span className="tv-guide-now" style={{ left: nowLeft }} />
        {loading && !visible.length && <span className="tv-guide-empty">carregando...</span>}
        {!loading && !visible.length && <span className="tv-guide-empty">sem EPG</span>}
        {visible.map((programme) => {
          const left = Math.max(0, ((programme.start - origin) / 60_000) * PX_PER_MIN)
          const right = Math.min(width, ((programme.stop - origin) / 60_000) * PX_PER_MIN)
          const live = programme.start <= now && programme.stop > now
          return (
            <button
              key={programme.start}
              type="button"
              className={live ? 'tv-guide-prog live' : programme.stop < now ? 'tv-guide-prog past' : 'tv-guide-prog'}
              style={{ left, width: Math.max(2, right - left - 2) }}
              onClick={() => onSelect(programme)}
              title={`${fmtTime(programme.start)} ${programme.title}`}
            >
              <strong>{programme.title}</strong>
              <small>
                {fmtTime(programme.start)}–{fmtTime(programme.stop)}
              </small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ProgrammeModal({
  playlistId,
  channel,
  programme,
  onClose,
  onWatch,
}: {
  playlistId: string
  channel: Channel
  programme: Programme
  onClose: () => void
  onWatch: () => void
}) {
  const ref = toChannelRef(playlistId, channel)
  const now = useNow()
  const scheduleOnce = () => {
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
    onClose()
  }
  return (
    <Modal title={programme.title} onClose={onClose}>
      <p className="tv-muted">
        {channel.name} · {fmtDateTime(programme.start)} até {fmtTime(programme.stop)}
        {programme.category ? ` · ${programme.category}` : ''}
      </p>
      {programme.desc && <p>{programme.desc}</p>}
      <div className="tv-actions">
        <button type="button" className="tv-btn" onClick={onWatch}>
          <Play size={15} /> Assistir canal
        </button>
        {programme.stop > now && (
          <button type="button" className="tv-btn" onClick={scheduleOnce}>
            <CalendarPlus size={15} /> {programme.start <= now ? 'Gravar o resto' : 'Gravar esta exibicao'}
          </button>
        )}
        <button
          type="button"
          className="tv-btn primary"
          onClick={() => {
            onClose()
            openRuleEditor(seriesDraftFromProgramme(ref, programme))
          }}
        >
          <Repeat size={15} /> Gravar todo dia
        </button>
      </div>
    </Modal>
  )
}
