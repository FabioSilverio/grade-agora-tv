import { CheckCircle2, CircleStop, FolderOpen, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { fmtBytes, fmtDateTime, fmtDuration } from '../format'
import { useNow } from '../hooks'
import {
  localDelete,
  localFileUrl,
  localOpenFolder,
  localSetOutputDir,
  localStop,
  refreshRecordings,
  useLocalService,
} from '../localService'
import type { RecordingInfo } from '../types'
import { Empty } from '../ui'
import type { PlayerSource } from './Player'
import { PlayerModal } from './VodView'

const STATUS_LABEL: Record<RecordingInfo['status'], string> = {
  starting: 'Conectando',
  recording: 'Gravando',
  reconnecting: 'Reconectando',
  finishing: 'Salvando',
  done: 'Concluida',
  failed: 'Falhou',
  stopped: 'Parada manualmente',
}

/** Gravacoes feitas pelo gravador do PC (funciona com o site fechado). */
export function LocalRecordingsView() {
  const local = useLocalService()
  const now = useNow(1000)
  const [dir, setDir] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [playing, setPlaying] = useState<PlayerSource | null>(null)
  const recordings = local.recordings
  const outputDir = local.status?.outputDir ?? ''

  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="tv-card tv-ok-box">
        <h3>
          <CheckCircle2 size={18} /> Gravador do PC ativo
        </h3>
        <p>
          Os agendamentos sao gravados pelo programa que roda escondido no seu PC — <strong>pode fechar o site</strong>. So precisa
          do PC ligado e com internet.
          {local.status?.keepAwake && ' Enquanto houver agendamentos, o Windows nao entra em suspensao sozinho.'}
        </p>
        <div className="tv-field">
          <span>Pasta das gravacoes (no PC)</span>
          <div className="tv-row">
            <input value={dir ?? outputDir} onChange={(event) => setDir(event.target.value)} spellCheck={false} />
            <div className="tv-actions left" style={{ flex: '0 0 auto' }}>
              {dir != null && dir !== outputDir && (
                <button
                  type="button"
                  className="tv-btn primary"
                  onClick={() =>
                    run(async () => {
                      await localSetOutputDir(dir)
                      setDir(null)
                      setSaved(true)
                      setTimeout(() => setSaved(false), 3000)
                    })
                  }
                >
                  Salvar pasta
                </button>
              )}
              <button type="button" className="tv-btn" onClick={() => run(localOpenFolder)}>
                <FolderOpen size={15} /> Abrir pasta
              </button>
            </div>
          </div>
          {saved && <small className="tv-ok">Pasta salva.</small>}
        </div>
        {error && <p className="tv-error">{error}</p>}
      </div>

      <section>
        <h2>Gravando agora</h2>
        {!recordings?.active.length && <p className="tv-muted">Nenhuma gravacao em andamento.</p>}
        <div className="tv-rec-grid">
          {recordings?.active.map((item) => {
            const elapsed = now - item.startedAt
            const total = Math.max(1, item.stopAt - item.startedAt)
            const rate = elapsed > 5000 ? (item.bytes * 8) / (elapsed / 1000) / 1_000_000 : 0
            return (
              <div key={item.id} className={`tv-card tv-rec ${item.status}`}>
                <div className="tv-rec-head">
                  <span className="tv-rec-dot" />
                  <strong>{item.title}</strong>
                  <span className="tv-badge">{STATUS_LABEL[item.status]}</span>
                </div>
                <p className="tv-muted">
                  {item.channelName} · termina {fmtDateTime(item.stopAt)}
                </p>
                <div className="tv-progress big">
                  <span style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }} />
                </div>
                <p className="tv-rec-stats">
                  {fmtDuration(elapsed)} gravados · faltam {fmtDuration(item.stopAt - now)} · {fmtBytes(item.bytes)}
                  {rate > 0 && ` · ${rate.toFixed(1)} Mbps`}
                </p>
                {item.message && <p className="tv-muted small">{item.message}</p>}
                <button type="button" className="tv-btn danger small" onClick={() => run(() => localStop(item.id))}>
                  <CircleStop size={14} /> Parar e salvar
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <div className="tv-section-head">
          <h2>Arquivos gravados</h2>
          <button type="button" className="tv-btn ghost small" onClick={() => void refreshRecordings()}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
        {!recordings?.files.length && <Empty title="Nenhum arquivo gravado ainda" />}
        <div className="tv-file-list">
          {recordings?.files.map((file) => (
            <div key={file.name} className="tv-file">
              <span className="tv-file-name">
                <strong>{file.name}</strong>
                <small>
                  {fmtBytes(file.size)} · {fmtDateTime(file.modified)}
                </small>
              </span>
              <span className="tv-actions">
                <button
                  type="button"
                  className="tv-btn small"
                  title="Assistir"
                  onClick={() =>
                    setPlaying({
                      key: `pc:${file.name}`,
                      title: file.name,
                      urls: [localFileUrl(file.name)],
                      live: false,
                      engine: /\.ts$/i.test(file.name) ? 'mpegts' : 'native',
                    })
                  }
                >
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  className="tv-btn small danger"
                  title="Excluir"
                  onClick={() => confirm(`Excluir "${file.name}" do PC?`) && run(() => localDelete(file.name))}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
        <p className="tv-muted small">
          Arquivos .ts abrem no VLC. Para converter em .mp4 sem perder qualidade: <code>ffmpeg -i arquivo.ts -c copy arquivo.mp4</code>
        </p>
      </section>

      {Boolean(recordings?.history.length) && (
        <section>
          <h2>Historico do gravador</h2>
          <div className="tv-file-list">
            {recordings?.history.slice(0, 40).map((item) => (
              <div key={item.id} className="tv-file">
                <span className="tv-file-name">
                  <strong>
                    {item.title} <span className={`tv-badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  </strong>
                  <small>
                    {item.channelName} · {fmtDateTime(item.startedAt)} · {fmtBytes(item.bytes)}
                    {item.message ? ` · ${item.message}` : ''}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {playing && <PlayerModal source={playing} onClose={() => setPlaying(null)} />}
    </>
  )
}
