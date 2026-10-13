import { CalendarClock, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useProgrammes } from '../epg'
import { ALL_DAYS, closeRuleEditor, useDraft, type Draft } from '../ruleDraft'
import { computeOccurrences, parseTime } from '../schedule'
import { store, useAppState } from '../state'
import { uid } from '../storage'
import type { ChannelRef, RecordingRule, RuleKind } from '../types'
import { fmtDateTime, fmtTime, toChannelRef, WEEKDAYS } from '../format'
import { useNow, usePlaylistData } from '../hooks'
import { Logo, Modal } from '../ui'

export function RuleEditorHost() {
  const current = useDraft()
  if (!current) return null
  return <RuleEditor key={current.id ?? 'new'} initial={current} onClose={closeRuleEditor} />
}

function toLocalInput(ts?: number) {
  if (!ts) return ''
  const date = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function RuleEditor({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const settings = useAppState((state) => state.settings)
  const activePlaylistId = useAppState((state) => state.activePlaylistId)
  const [rule, setRule] = useState<RecordingRule>(() => ({
    id: initial.id ?? uid('rule'),
    kind: initial.kind ?? 'series',
    enabled: initial.enabled ?? true,
    channel: initial.channel ?? ({ playlistId: activePlaylistId ?? '', channelId: '', name: '', url: '' } as ChannelRef),
    title: initial.title ?? '',
    match: initial.match ?? 'contains',
    days: initial.days ?? ALL_DAYS,
    time: initial.time ?? '20:00',
    durationMin: initial.durationMin ?? 60,
    toleranceMin: initial.toleranceMin ?? 90,
    fallbackToTime: initial.fallbackToTime ?? false,
    padBeforeMin: initial.padBeforeMin ?? settings.padBeforeMin,
    padAfterMin: initial.padAfterMin ?? settings.padAfterMin,
    start: initial.start,
    stop: initial.stop,
    createdAt: initial.createdAt ?? Date.now(),
  }))
  const [error, setError] = useState('')
  const update = (patch: Partial<RecordingRule>) => setRule((current) => ({ ...current, ...patch }))

  const channelKey = rule.channel.channelId
    ? { epgId: rule.channel.epgId, streamId: rule.channel.streamId, name: rule.channel.name }
    : null
  const { list: programmes, loading } = useProgrammes(rule.channel.channelId ? rule.channel.playlistId : null, channelKey)

  const now = useNow(60_000)
  const preview = useMemo(() => {
    if (!rule.channel.channelId) return []
    return computeOccurrences({ ...rule, enabled: true }, programmes, now, now + 7 * 86_400_000).slice(0, 8)
  }, [rule, programmes, now])

  const save = () => {
    if (!rule.channel.channelId) return setError('Escolha o canal.')
    if (rule.kind === 'series' && !rule.title.trim()) return setError('Informe o titulo do programa como aparece na EPG.')
    if (rule.kind !== 'once' && !rule.days.length) return setError('Escolha pelo menos um dia da semana.')
    if (rule.kind === 'daily' && parseTime(rule.time) == null) return setError('Horario invalido (use HH:MM).')
    if (rule.kind === 'once' && (!rule.start || !rule.stop || rule.stop <= rule.start)) return setError('Defina inicio e fim.')
    store.set((state) => {
      const exists = state.rules.some((item) => item.id === rule.id)
      return { rules: exists ? state.rules.map((item) => (item.id === rule.id ? rule : item)) : [...state.rules, rule] }
    })
    if (settings.notifications && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
    onClose()
  }

  const kinds: Array<{ id: RuleKind; label: string; hint: string }> = [
    { id: 'series', label: 'Programa (EPG)', hint: 'Procura o titulo na EPG todo dia e grava no horario em que ele passar.' },
    { id: 'daily', label: 'Horario fixo', hint: 'Grava sempre no mesmo horario, sem depender da EPG.' },
    { id: 'once', label: 'Uma vez', hint: 'Grava uma unica janela de tempo.' },
  ]

  return (
    <Modal title={initial.id ? 'Editar agendamento' : 'Novo agendamento'} onClose={onClose} wide>
      <div className="tv-form">
        <div className="tv-field">
          <span>Canal</span>
          {rule.channel.channelId ? (
            <div className="tv-chosen-channel">
              <Logo src={rule.channel.logo} name={rule.channel.name} size={32} />
              <strong>{rule.channel.name}</strong>
              <button type="button" className="tv-btn ghost small" onClick={() => update({ channel: { ...rule.channel, channelId: '' } })}>
                Trocar
              </button>
            </div>
          ) : (
            <ChannelPicker playlistId={rule.channel.playlistId || activePlaylistId} onPick={(channel) => update({ channel })} />
          )}
        </div>

        <div className="tv-field">
          <span>Tipo</span>
          <div className="tv-segmented">
            {kinds.map((kind) => (
              <button key={kind.id} type="button" className={rule.kind === kind.id ? 'active' : ''} onClick={() => update({ kind: kind.id })}>
                {kind.label}
              </button>
            ))}
          </div>
          <small>{kinds.find((kind) => kind.id === rule.kind)?.hint}</small>
        </div>

        <label className="tv-field">
          <span>{rule.kind === 'series' ? 'Titulo na EPG' : 'Nome da gravacao (opcional)'}</span>
          <input value={rule.title} onChange={(event) => update({ title: event.target.value })} placeholder="Ex.: Jornal Nacional" />
        </label>

        {rule.kind === 'series' && (
          <div className="tv-field">
            <span>Comparacao do titulo</span>
            <div className="tv-segmented">
              <button type="button" className={rule.match === 'contains' ? 'active' : ''} onClick={() => update({ match: 'contains' })}>
                Contem o texto
              </button>
              <button type="button" className={rule.match === 'exact' ? 'active' : ''} onClick={() => update({ match: 'exact' })}>
                Titulo exato
              </button>
            </div>
          </div>
        )}

        {rule.kind !== 'once' && (
          <div className="tv-field">
            <span>Dias</span>
            <div className="tv-days">
              {WEEKDAYS.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  className={rule.days.includes(day) ? 'active' : ''}
                  onClick={() =>
                    update({ days: rule.days.includes(day) ? rule.days.filter((item) => item !== day) : [...rule.days, day].sort() })
                  }
                >
                  {label}
                </button>
              ))}
              <button type="button" className="link" onClick={() => update({ days: ALL_DAYS })}>
                todos
              </button>
              <button type="button" className="link" onClick={() => update({ days: [1, 2, 3, 4, 5] })}>
                seg-sex
              </button>
            </div>
          </div>
        )}

        {rule.kind !== 'once' && (
          <div className="tv-row">
            <label className="tv-field">
              <span>{rule.kind === 'series' ? 'Horario habitual' : 'Horario'}</span>
              <input type="time" value={rule.time ?? ''} onChange={(event) => update({ time: event.target.value })} />
            </label>
            <label className="tv-field">
              <span>Duracao (min)</span>
              <input
                type="number"
                min={1}
                value={rule.durationMin ?? 60}
                onChange={(event) => update({ durationMin: Number(event.target.value) || 60 })}
              />
            </label>
            {rule.kind === 'series' && (
              <label className="tv-field">
                <span>Quais exibicoes</span>
                <select value={rule.toleranceMin} onChange={(event) => update({ toleranceMin: Number(event.target.value) })}>
                  <option value={30}>Perto do horario habitual (±30 min)</option>
                  <option value={90}>Perto do horario habitual (±1h30)</option>
                  <option value={180}>Perto do horario habitual (±3h)</option>
                  <option value={0}>Qualquer horario (inclui reprises)</option>
                </select>
              </label>
            )}
          </div>
        )}

        {rule.kind === 'series' && (
          <label className="tv-check">
            <input type="checkbox" checked={rule.fallbackToTime} onChange={(event) => update({ fallbackToTime: event.target.checked })} />
            <span>Se a EPG estiver sem dados no dia, gravar mesmo assim no horario habitual</span>
          </label>
        )}

        {rule.kind === 'once' && (
          <div className="tv-row">
            <label className="tv-field">
              <span>Inicio</span>
              <input
                type="datetime-local"
                value={toLocalInput(rule.start)}
                onChange={(event) => update({ start: new Date(event.target.value).getTime() || undefined })}
              />
            </label>
            <label className="tv-field">
              <span>Fim</span>
              <input
                type="datetime-local"
                value={toLocalInput(rule.stop)}
                onChange={(event) => update({ stop: new Date(event.target.value).getTime() || undefined })}
              />
            </label>
          </div>
        )}

        <div className="tv-row">
          <label className="tv-field">
            <span>Comecar antes (min)</span>
            <input type="number" min={0} value={rule.padBeforeMin} onChange={(event) => update({ padBeforeMin: Number(event.target.value) || 0 })} />
          </label>
          <label className="tv-field">
            <span>Terminar depois (min)</span>
            <input type="number" min={0} value={rule.padAfterMin} onChange={(event) => update({ padAfterMin: Number(event.target.value) || 0 })} />
          </label>
        </div>

        <div className="tv-preview">
          <h4>
            <CalendarClock size={16} /> Proximas gravacoes
          </h4>
          {loading && rule.kind !== 'once' && <p className="tv-muted">Consultando EPG...</p>}
          {!loading && !preview.length && (
            <p className="tv-muted">
              {rule.kind === 'series'
                ? 'Nada encontrado na EPG dos proximos dias com esse titulo/horario. A regra continua valendo e sera reavaliada quando a EPG atualizar.'
                : 'Nenhuma gravacao nos proximos 7 dias.'}
            </p>
          )}
          <ul>
            {preview.map((item) => (
              <li key={item.key}>
                <strong>{fmtDateTime(item.programStart)}</strong> ate {fmtTime(item.programStop)} — {item.title}
                {item.source === 'time' && <em className="tv-tag">horario fixo</em>}
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="tv-error">{error}</p>}
        <div className="tv-actions">
          <button type="button" className="tv-btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="tv-btn primary" onClick={save}>
            Salvar agendamento
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ChannelPicker({ playlistId, onPick }: { playlistId: string | null; onPick: (channel: ChannelRef) => void }) {
  const playlists = useAppState((state) => state.playlists)
  const [selectedPlaylist, setSelectedPlaylist] = useState(playlistId ?? playlists[0]?.id ?? null)
  const { data, loading } = usePlaylistData(selectedPlaylist)
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!data || !term) return []
    return data.channels.filter((channel) => channel.name.toLowerCase().includes(term)).slice(0, 50)
  }, [data, query])

  return (
    <div className="tv-picker">
      <div className="tv-row">
        {playlists.length > 1 && (
          <select value={selectedPlaylist ?? ''} onChange={(event) => setSelectedPlaylist(event.target.value)}>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
              </option>
            ))}
          </select>
        )}
        <label className="tv-search">
          <Search size={16} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar canal..." />
        </label>
      </div>
      {loading && <p className="tv-muted">Carregando canais...</p>}
      <div className="tv-picker-list">
        {results.map((channel) => (
          <button key={channel.id} type="button" onClick={() => selectedPlaylist && onPick(toChannelRef(selectedPlaylist, channel))}>
            <Logo src={channel.logo} name={channel.name} size={28} />
            <span>{channel.name}</span>
            <small>{channel.group}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
