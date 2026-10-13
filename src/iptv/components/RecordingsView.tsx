import { CircleStop, Download, FolderInput, FolderOpen, HardDrive, Play, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  authorizeFolder,
  chooseFolder,
  clearHistory,
  deleteStoredFile,
  forgetFolder,
  getStoredFile,
  isActive,
  listFiles,
  moveToFolder,
  storageEstimate,
  stopRecording,
  supportsFolder,
  useFolderState,
  useRecordings,
  type StoredFile,
} from '../recorder'
import type { RecordingInfo } from '../types'
import { fmtBytes, fmtDateTime, fmtDuration } from '../format'
import { useNow } from '../hooks'
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

export function FolderCard() {
  const folder = useFolderState()
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  useEffect(() => {
    void storageEstimate().then(setEstimate)
  }, [])

  return (
    <div className="tv-card">
      <h3>
        <HardDrive size={18} /> Onde salvar as gravacoes
      </h3>
      {!supportsFolder ? (
        <p className="tv-muted">
          Este navegador nao permite escolher uma pasta. As gravacoes ficam salvas dentro do navegador e voce baixa pelo botao
          “Baixar”. Para salvar direto numa pasta do PC, use Chrome ou Edge.
        </p>
      ) : folder.name ? (
        <>
          <p>
            Pasta: <strong>{folder.name}</strong>{' '}
            {folder.permission === 'granted' ? (
              <span className="tv-ok">autorizada</span>
            ) : (
              <span className="tv-warn">precisa reautorizar</span>
            )}
          </p>
          {folder.permission !== 'granted' && (
            <p className="tv-warn-box">
              <TriangleAlert size={16} /> Depois de reabrir o navegador ele pede permissao de novo. Sem ela, as gravacoes ficam no
              navegador ate voce mover.
            </p>
          )}
          <div className="tv-actions left">
            {folder.permission !== 'granted' && (
              <button type="button" className="tv-btn primary" onClick={() => void authorizeFolder()}>
                Autorizar pasta
              </button>
            )}
            <button type="button" className="tv-btn ghost" onClick={() => void chooseFolder().catch(() => undefined)}>
              <FolderOpen size={15} /> Trocar pasta
            </button>
            <button type="button" className="tv-btn ghost" onClick={() => void forgetFolder()}>
              Usar so o navegador
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="tv-muted">
            Sem pasta escolhida: as gravacoes ficam no armazenamento do navegador. Escolha uma pasta (ex.: Videos\Gravacoes) para
            os arquivos irem direto para o PC ao terminar.
          </p>
          <button type="button" className="tv-btn primary" onClick={() => void chooseFolder().catch(() => undefined)}>
            <FolderOpen size={15} /> Escolher pasta
          </button>
        </>
      )}
      {estimate && estimate.quota > 0 && (
        <p className="tv-muted small">
          Espaco do navegador: {fmtBytes(estimate.usage)} usados de {fmtBytes(estimate.quota)} disponiveis.
        </p>
      )}
    </div>
  )
}

export function RecordingsView() {
  const recordings = useRecordings()
  const now = useNow(1000)
  const [files, setFiles] = useState<StoredFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<{ source: PlayerSource; url: string } | null>(null)
  const folder = useFolderState()

  const active = recordings.filter(isActive)
  const history = recordings.filter((item) => !isActive(item))

  const refresh = useCallback(async () => {
    setLoadingFiles(true)
    try {
      setFiles(await listFiles())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  const finishedCount = history.length
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh, finishedCount, folder.permission, folder.name])

  const withFile = async (file: StoredFile, action: (blob: File) => void) => {
    try {
      action(await getStoredFile(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const play = (file: StoredFile) =>
    withFile(file, (blob) => {
      const url = URL.createObjectURL(blob)
      setPlaying({
        url,
        source: {
          key: `file:${file.location}:${file.name}`,
          title: file.name,
          urls: [url],
          live: false,
          engine: /\.ts$/i.test(file.name) ? 'mpegts' : 'native',
        },
      })
    })

  const download = (file: StoredFile) =>
    withFile(file, (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    })

  const remove = async (file: StoredFile) => {
    if (!confirm(`Excluir "${file.name}"?`)) return
    try {
      await deleteStoredFile(file)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const move = async (file: StoredFile) => {
    try {
      await moveToFolder(file)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="tv-page">
      <section>
        <h2>Gravando agora</h2>
        {!active.length && <p className="tv-muted">Nenhuma gravacao em andamento.</p>}
        <div className="tv-rec-grid">
          {active.map((item) => {
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
                <button type="button" className="tv-btn danger small" onClick={() => stopRecording(item.id)}>
                  <CircleStop size={14} /> Parar e salvar
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <FolderCard />

      <section>
        <div className="tv-section-head">
          <h2>Arquivos gravados</h2>
          <button type="button" className="tv-btn ghost small" onClick={() => void refresh()}>
            <RefreshCw size={14} className={loadingFiles ? 'tv-spin' : ''} /> Atualizar
          </button>
        </div>
        {error && <p className="tv-error">{error}</p>}
        {!files.length && !loadingFiles && <Empty title="Nenhum arquivo gravado ainda" />}
        <div className="tv-file-list">
          {files.map((file) => (
            <div key={`${file.location}:${file.name}`} className="tv-file">
              <span className="tv-file-name">
                <strong>{file.name}</strong>
                <small>
                  {fmtBytes(file.size)} · {fmtDateTime(file.modified)} ·{' '}
                  {file.location === 'folder' ? `pasta ${folder.name ?? ''}` : 'no navegador'}
                </small>
              </span>
              <span className="tv-actions">
                <button type="button" className="tv-btn small" onClick={() => void play(file)} title="Assistir">
                  <Play size={14} />
                </button>
                <button type="button" className="tv-btn small" onClick={() => void download(file)} title="Baixar">
                  <Download size={14} />
                </button>
                {file.location === 'browser' && folder.permission === 'granted' && (
                  <button type="button" className="tv-btn small" onClick={() => void move(file)} title="Mover para a pasta">
                    <FolderInput size={14} />
                  </button>
                )}
                <button type="button" className="tv-btn small danger" onClick={() => void remove(file)} title="Excluir">
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
        <p className="tv-muted small">
          Arquivos .ts abrem no VLC, MPC-HC ou no proprio player daqui. Para converter em .mp4 sem perder qualidade:{' '}
          <code>ffmpeg -i arquivo.ts -c copy arquivo.mp4</code>
        </p>
      </section>

      {history.length > 0 && (
        <section>
          <div className="tv-section-head">
            <h2>Historico</h2>
            <button type="button" className="tv-btn ghost small" onClick={clearHistory}>
              Limpar
            </button>
          </div>
          <div className="tv-file-list">
            {history.map((item) => (
              <div key={item.id} className="tv-file">
                <span className="tv-file-name">
                  <strong>
                    {item.title} <span className={`tv-badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  </strong>
                  <small>
                    {item.channelName} · {fmtDateTime(item.startedAt)} · {fmtBytes(item.bytes)}
                    {item.savedTo === 'folder' ? ' · salvo na pasta' : item.savedTo === 'browser' ? ' · salvo no navegador' : ''}
                    {item.message ? ` · ${item.message}` : ''}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {playing && (
        <PlayerModal
          source={playing.source}
          onClose={() => {
            URL.revokeObjectURL(playing.url)
            setPlaying(null)
          }}
        />
      )}
    </div>
  )
}
