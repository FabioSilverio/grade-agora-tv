import { Check, ListVideo, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EPG_PRESETS, reloadEpg } from '../epg'
import { forgetPlaylist, getPlaylistData, m3uFileKey } from '../playlists'
import { netConfig, store, useAppState } from '../state'
import { idb, uid } from '../storage'
import type { EpgMode, PlaylistConfig } from '../types'
import { credsFromGetPhp, normalizeServer, XtreamClient } from '../xtream'
import { Modal } from '../ui'

type Form = {
  id?: string
  kind: 'm3u' | 'xtream'
  name: string
  url: string
  file: File | null
  server: string
  username: string
  password: string
  epgMode: EpgMode
  customEpgUrl: string
  epgShiftHours: number
}

const EMPTY: Form = {
  kind: 'xtream',
  name: '',
  url: '',
  file: null,
  server: '',
  username: '',
  password: '',
  epgMode: 'xtream-api',
  customEpgUrl: '',
  epgShiftHours: 0,
}

function toForm(config: PlaylistConfig): Form {
  return {
    ...EMPTY,
    id: config.id,
    kind: config.kind,
    name: config.name,
    url: config.kind === 'm3u' ? (config.url ?? '') : '',
    server: config.kind === 'xtream' ? config.server : '',
    username: config.kind === 'xtream' ? config.username : '',
    password: config.kind === 'xtream' ? config.password : '',
    epgMode: config.epgMode,
    customEpgUrl: config.customEpgUrl ?? '',
    epgShiftHours: config.epgShiftHours ?? 0,
  }
}

export function PlaylistManager({ onClose, startWithForm }: { onClose?: () => void; startWithForm?: boolean }) {
  const playlists = useAppState((state) => state.playlists)
  const activeId = useAppState((state) => state.activePlaylistId)
  const [form, setForm] = useState<Form | null>(startWithForm || !playlists.length ? EMPTY : null)

  const remove = async (config: PlaylistConfig) => {
    if (!confirm(`Remover a playlist "${config.name}"? Agendamentos dela deixam de funcionar.`)) return
    await forgetPlaylist(config.id)
    store.set((state) => {
      const rest = state.playlists.filter((item) => item.id !== config.id)
      return {
        playlists: rest,
        activePlaylistId: state.activePlaylistId === config.id ? (rest[0]?.id ?? null) : state.activePlaylistId,
      }
    })
  }

  const content = form ? (
    <PlaylistForm initial={form} onDone={() => (playlists.length || form.id ? setForm(null) : onClose?.())} onCancel={() => setForm(null)} canCancel={playlists.length > 0} />
  ) : (
    <div className="tv-playlists">
      {playlists.map((config) => (
        <div key={config.id} className={config.id === activeId ? 'tv-playlist active' : 'tv-playlist'}>
          <ListVideo size={20} />
          <span className="tv-file-name">
            <strong>{config.name}</strong>
            <small>
              {config.kind === 'xtream' ? `Xtream · ${config.server}` : config.url ? `M3U · ${config.url}` : `M3U · arquivo ${config.fileName ?? ''}`}
            </small>
          </span>
          <span className="tv-actions">
            {config.id !== activeId && (
              <button
                type="button"
                className="tv-btn small"
                onClick={() => {
                  store.set({ activePlaylistId: config.id })
                  onClose?.()
                }}
              >
                <Check size={14} /> Usar
              </button>
            )}
            <button type="button" className="tv-btn small" onClick={() => setForm(toForm(config))} title="Editar">
              <Pencil size={14} />
            </button>
            <button type="button" className="tv-btn small danger" onClick={() => void remove(config)} title="Remover">
              <Trash2 size={14} />
            </button>
          </span>
        </div>
      ))}
      <button type="button" className="tv-btn primary" onClick={() => setForm(EMPTY)}>
        <Plus size={15} /> Adicionar playlist
      </button>
    </div>
  )

  if (!onClose) return content
  return (
    <Modal title={form ? (form.id ? 'Editar playlist' : 'Nova playlist') : 'Playlists'} onClose={onClose} wide>
      {content}
    </Modal>
  )
}

function PlaylistForm({ initial, onDone, onCancel, canCancel }: { initial: Form; onDone: () => void; onCancel: () => void; canCancel: boolean }) {
  const [form, setForm] = useState<Form>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))

  const setKind = (kind: Form['kind']) =>
    update({ kind, epgMode: kind === 'xtream' ? 'xtream-api' : form.epgMode === 'xtream-api' ? 'provider-xmltv' : form.epgMode })

  // Colou um link get.php? Converte para Xtream (traz filmes, series e EPG por canal).
  const onUrl = (url: string) => {
    const creds = credsFromGetPhp(url)
    if (creds && form.kind === 'm3u') {
      update({ kind: 'xtream', server: creds.server, username: creds.username, password: creds.password, url: '', epgMode: 'xtream-api' })
      return
    }
    update({ url })
  }

  const save = async () => {
    setError('')
    const id = form.id ?? uid('pl')
    const base = {
      id,
      name: form.name.trim() || (form.kind === 'xtream' ? new URL(normalizeServer(form.server || 'x')).hostname : form.file?.name || 'Minha lista'),
      epgMode: form.epgMode,
      customEpgUrl: form.customEpgUrl.trim() || undefined,
      epgShiftHours: form.epgShiftHours || 0,
      createdAt: Date.now(),
    }
    let config: PlaylistConfig
    if (form.kind === 'xtream') {
      if (!form.server.trim() || !form.username.trim() || !form.password.trim()) return setError('Preencha servidor, usuario e senha.')
      config = { ...base, kind: 'xtream', server: normalizeServer(form.server), username: form.username.trim(), password: form.password.trim() }
    } else {
      if (!form.url.trim() && !form.file && !form.id) return setError('Informe a URL da lista ou escolha um arquivo .m3u.')
      const previous = store.get().playlists.find((item) => item.id === id)
      const previousFile = previous?.kind === 'm3u' ? previous.fileName : undefined
      const url = form.file ? undefined : form.url.trim() || undefined
      config = { ...base, kind: 'm3u', url, fileName: form.file?.name ?? (url ? undefined : previousFile) }
    }
    if (config.epgMode === 'custom' && !config.customEpgUrl) return setError('Informe a URL da EPG (XMLTV).')

    setBusy(true)
    try {
      if (config.kind === 'xtream') {
        // valida login antes de salvar
        const client = new XtreamClient(config, netConfig())
        const auth = await client.api<{ user_info?: { auth?: number; message?: string } }>()
        if (!auth?.user_info || auth.user_info.auth === 0) throw new Error('Login recusado pelo servidor.')
      }
      await Promise.all([idb.del(`playlist:${id}`), idb.del(`xmltv:${id}`)]).catch(() => undefined)
      if (config.kind === 'm3u' && form.file) await idb.set(m3uFileKey(id), await form.file.text())
      const data = await getPlaylistData(config, { force: true })
      if (!data.channels.length && !data.movies.length) throw new Error('A lista carregou, mas nao tem canais.')
      store.set((state) => {
        const exists = state.playlists.some((item) => item.id === id)
        return {
          playlists: exists ? state.playlists.map((item) => (item.id === id ? { ...config, createdAt: item.createdAt } : item)) : [...state.playlists, config],
          activePlaylistId: id,
        }
      })
      reloadEpg(id)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tv-form">
      <div className="tv-segmented">
        <button type="button" className={form.kind === 'xtream' ? 'active' : ''} onClick={() => setKind('xtream')}>
          Xtream Codes
        </button>
        <button type="button" className={form.kind === 'm3u' ? 'active' : ''} onClick={() => setKind('m3u')}>
          Lista M3U
        </button>
      </div>

      <label className="tv-field">
        <span>Nome</span>
        <input value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="Ex.: Minha IPTV" />
      </label>

      {form.kind === 'xtream' ? (
        <>
          <label className="tv-field">
            <span>Servidor (URL com porta)</span>
            <input value={form.server} onChange={(event) => update({ server: event.target.value })} placeholder="http://servidor.com:8080" />
          </label>
          <div className="tv-row">
            <label className="tv-field">
              <span>Usuario</span>
              <input value={form.username} onChange={(event) => update({ username: event.target.value })} autoComplete="off" />
            </label>
            <label className="tv-field">
              <span>Senha</span>
              <input type="password" value={form.password} onChange={(event) => update({ password: event.target.value })} autoComplete="off" />
            </label>
          </div>
        </>
      ) : (
        <>
          <label className="tv-field">
            <span>URL da lista (.m3u / .m3u8)</span>
            <input value={form.url} onChange={(event) => onUrl(event.target.value)} placeholder="http://servidor/get.php?username=...&type=m3u_plus" />
            <small>Links get.php com usuario e senha viram Xtream automaticamente (traz filmes, series e EPG).</small>
          </label>
          <label className="tv-field">
            <span>…ou arquivo do PC</span>
            <input type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl" onChange={(event) => update({ file: event.target.files?.[0] ?? null })} />
          </label>
        </>
      )}

      <div className="tv-field">
        <span>Guia de programacao (EPG)</span>
        <select value={form.epgMode} onChange={(event) => update({ epgMode: event.target.value as EpgMode })}>
          {form.kind === 'xtream' && <option value="xtream-api">Do provedor, por canal (recomendado para Xtream)</option>}
          <option value="provider-xmltv">{form.kind === 'xtream' ? 'Do provedor, arquivo XMLTV completo' : 'A indicada na lista (url-tvg)'}</option>
          <option value="custom">Outra URL XMLTV</option>
          <option value="none">Sem EPG</option>
        </select>
      </div>

      {form.epgMode === 'custom' && (
        <label className="tv-field">
          <span>URL XMLTV (.xml ou .xml.gz)</span>
          <input value={form.customEpgUrl} onChange={(event) => update({ customEpgUrl: event.target.value })} placeholder="https://.../guide.xml.gz" />
          <span className="tv-chips">
            {EPG_PRESETS.map((preset) => (
              <button key={preset.url} type="button" className="tv-chip" onClick={() => update({ customEpgUrl: preset.url })}>
                {preset.label}
              </button>
            ))}
          </span>
        </label>
      )}

      {form.epgMode !== 'none' && (
        <label className="tv-field">
          <span>Ajuste de fuso da EPG (horas)</span>
          <input type="number" step={0.5} value={form.epgShiftHours} onChange={(event) => update({ epgShiftHours: Number(event.target.value) || 0 })} />
          <small>Use se a grade aparecer adiantada/atrasada (ex.: -3 ou +1).</small>
        </label>
      )}

      {error && <p className="tv-error">{error}</p>}
      <div className="tv-actions">
        {canCancel && (
          <button type="button" className="tv-btn ghost" onClick={onCancel} disabled={busy}>
            Voltar
          </button>
        )}
        <button type="button" className="tv-btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Conectando e carregando canais...' : 'Salvar e carregar'}
        </button>
      </div>
      <p className="tv-muted small">Usuario e senha ficam salvos so neste navegador. As requisicoes passam pelo proxy deste site apenas para contornar CORS.</p>
    </div>
  )
}
