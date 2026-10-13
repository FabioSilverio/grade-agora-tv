import { CalendarClock, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { isActive, useFolderState, useRecordings } from '../recorder'
import { ruleError, useIsLeader, useUpcoming } from '../scheduler'
import { store, useAppState } from '../state'
import type { RecordingRule } from '../types'
import { fmtDateTime, fmtTime, WEEKDAYS } from '../format'
import { Empty, Logo } from '../ui'
import { openRuleEditor } from '../ruleDraft'

function describeRule(rule: RecordingRule) {
  const days =
    rule.days.length === 7
      ? 'todo dia'
      : rule.days.join() === '1,2,3,4,5'
        ? 'seg a sex'
        : rule.days.map((day) => WEEKDAYS[day]).join(', ')
  if (rule.kind === 'once') return `Uma vez · ${rule.start ? fmtDateTime(rule.start) : ''}–${rule.stop ? fmtTime(rule.stop) : ''}`
  if (rule.kind === 'daily') return `Horario fixo · ${days} as ${rule.time} por ${rule.durationMin} min`
  const where = rule.toleranceMin ? `perto das ${rule.time} (±${rule.toleranceMin} min)` : 'em qualquer horario'
  return `EPG: titulo ${rule.match === 'exact' ? 'igual a' : 'contendo'} “${rule.title}” · ${days}, ${where}${
    rule.fallbackToTime ? ' · sem EPG grava no horario habitual' : ''
  }`
}

export function ScheduleView() {
  const rules = useAppState((state) => state.rules)
  const playlists = useAppState((state) => state.playlists)
  const upcoming = useUpcoming()
  const recordings = useRecordings()
  const folder = useFolderState()
  const leader = useIsLeader()

  const toggle = (rule: RecordingRule) =>
    store.set((state) => ({ rules: state.rules.map((item) => (item.id === rule.id ? { ...item, enabled: !item.enabled } : item)) }))
  const remove = (rule: RecordingRule) => {
    if (!confirm(`Excluir o agendamento "${rule.title || rule.channel.name}"?`)) return
    store.set((state) => ({ rules: state.rules.filter((item) => item.id !== rule.id) }))
  }

  const activeKeys = new Set(recordings.filter(isActive).map((item) => item.occurrenceKey))

  return (
    <div className="tv-page">
      <div className="tv-warn-box">
        <TriangleAlert size={18} />
        <span>
          As gravacoes acontecem <strong>neste navegador</strong>: deixe esta aba aberta (pode ficar minimizada) e o PC ligado,
          sem suspender. Em Configuracoes de energia do Windows, ajuste “Suspender” para “Nunca” enquanto houver gravacoes.
          {folder.name && folder.permission !== 'granted' && ' A pasta de gravacoes precisa ser reautorizada (aba Gravacoes).'}
        </span>
      </div>

      {!leader && (
        <div className="tv-warn-box">
          <TriangleAlert size={18} />
          <span>O app esta aberto em outra aba: e ela que faz as gravacoes. Feche as abas extras para evitar confusao.</span>
        </div>
      )}

      <section>
        <div className="tv-section-head">
          <h2>Agendamentos</h2>
          <button type="button" className="tv-btn primary" onClick={() => openRuleEditor({ kind: 'series' })}>
            <Plus size={15} /> Novo agendamento
          </button>
        </div>
        {!rules.length && (
          <Empty icon={<CalendarClock size={32} />} title="Nenhum agendamento">
            <p>
              Na aba Ao vivo, abra um canal e clique em <strong>Todo dia</strong> ao lado de um programa da EPG. Ele sera gravado
              diariamente no horario em que passar, mesmo que a emissora mude o horario um pouco.
            </p>
          </Empty>
        )}
        <div className="tv-file-list">
          {rules.map((rule) => {
            const error = ruleError(rule.id)
            const playlist = playlists.find((item) => item.id === rule.channel.playlistId)
            return (
              <div key={rule.id} className={rule.enabled ? 'tv-rule' : 'tv-rule off'}>
                <Logo src={rule.channel.logo} name={rule.channel.name} size={38} />
                <span className="tv-file-name">
                  <strong>{rule.title || rule.channel.name}</strong>
                  <small>
                    {rule.channel.name}
                    {playlist ? ` · ${playlist.name}` : ' · playlist removida'}
                  </small>
                  <small>{describeRule(rule)}</small>
                  {error && <small className="tv-error">EPG: {error}</small>}
                </span>
                <span className="tv-actions">
                  <label className="tv-switch" title={rule.enabled ? 'Ativo' : 'Pausado'}>
                    <input type="checkbox" checked={rule.enabled} onChange={() => toggle(rule)} />
                    <span />
                  </label>
                  <button type="button" className="tv-btn small" onClick={() => openRuleEditor(rule)} title="Editar">
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="tv-btn small danger" onClick={() => remove(rule)} title="Excluir">
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2>Proximas gravacoes</h2>
        {!upcoming.length && <p className="tv-muted">Nada programado para os proximos 7 dias.</p>}
        <div className="tv-file-list">
          {upcoming.slice(0, 60).map((item) => {
            const recording = activeKeys.has(item.key)
            return (
              <div key={item.key} className="tv-upcoming">
                <span className="tv-upcoming-time">
                  <strong>{fmtDateTime(item.programStart)}</strong>
                  <small>ate {fmtTime(item.programStop)}</small>
                </span>
                <span className="tv-file-name">
                  <strong>
                    {item.title}
                    {recording && <em className="tv-live-tag">GRAVANDO</em>}
                    {item.source === 'time' && <em className="tv-tag">horario fixo</em>}
                  </strong>
                  <small>
                    {item.channel.name} · grava de {fmtTime(item.start)} a {fmtTime(item.stop)}
                  </small>
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
