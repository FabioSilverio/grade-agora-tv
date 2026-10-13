import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_SETTINGS, store, useAppState } from '../state'
import { idb } from '../storage'
import type { Settings } from '../types'
import { FolderCard } from './RecordingsView'

export function SettingsView() {
  const settings = useAppState((state) => state.settings)
  const update = (patch: Partial<Settings>) => store.set((state) => ({ settings: { ...state.settings, ...patch } }))
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; message?: string }>({ state: 'idle' })

  const testProxy = async () => {
    setTest({ state: 'running' })
    try {
      const base = new URL(settings.proxyBase || '/api/proxy', location.href)
      base.searchParams.set('url', `${location.origin}/favicon.svg`)
      const response = await fetch(base)
      // O proxy da Vercel bloqueia hosts privados; 403 tambem prova que ele respondeu.
      if (response.ok || response.status === 403) setTest({ state: 'ok', message: 'Proxy respondendo.' })
      else setTest({ state: 'fail', message: `Proxy respondeu HTTP ${response.status}.` })
    } catch (error) {
      setTest({ state: 'fail', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const clearCaches = async () => {
    if (!confirm('Apagar listas e EPG em cache? (playlists, agendamentos e gravacoes continuam)')) return
    const keys = await idb.keys()
    await Promise.all(
      keys.filter((key) => /^(playlist:|xmltv:|epgx:)/.test(String(key))).map((key) => idb.del(String(key))),
    )
    location.reload()
  }

  return (
    <div className="tv-page narrow">
      <FolderCard />

      <div className="tv-card tv-form">
        <h3>Gravacao</h3>
        <div className="tv-row">
          <label className="tv-field">
            <span>Margem antes (min)</span>
            <input type="number" min={0} value={settings.padBeforeMin} onChange={(event) => update({ padBeforeMin: Number(event.target.value) || 0 })} />
          </label>
          <label className="tv-field">
            <span>Margem depois (min)</span>
            <input type="number" min={0} value={settings.padAfterMin} onChange={(event) => update({ padAfterMin: Number(event.target.value) || 0 })} />
          </label>
          <label className="tv-field">
            <span>Qualidade (HLS)</span>
            <select value={settings.hlsQuality} onChange={(event) => update({ hlsQuality: event.target.value as Settings['hlsQuality'] })}>
              <option value="best">Melhor disponivel</option>
              <option value="lowest">Menor (economiza espaco)</option>
            </select>
          </label>
        </div>
        <label className="tv-check">
          <input type="checkbox" checked={settings.keepAwake} onChange={(event) => update({ keepAwake: event.target.checked })} />
          <span>Manter a tela/PC acordado enquanto houver agendamentos ativos (funciona com a aba visivel)</span>
        </label>
        <label className="tv-check">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={(event) => {
              update({ notifications: event.target.checked })
              if (event.target.checked && typeof Notification !== 'undefined') void Notification.requestPermission()
            }}
          />
          <span>Notificar quando uma gravacao comecar/terminar</span>
        </label>
      </div>

      <div className="tv-card tv-form">
        <h3>Reproducao e rede</h3>
        <label className="tv-check">
          <input type="checkbox" checked={settings.preferHls} onChange={(event) => update({ preferHls: event.target.checked })} />
          <span>Preferir HLS (.m3u8) em servidores Xtream — mais compativel com o navegador e com o proxy</span>
        </label>
        <div className="tv-field">
          <span>Uso do proxy</span>
          <div className="tv-segmented">
            {(
              [
                ['auto', 'Automatico'],
                ['always', 'Sempre'],
                ['never', 'Nunca'],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" className={settings.proxyMode === value ? 'active' : ''} onClick={() => update({ proxyMode: value })}>
                {label}
              </button>
            ))}
          </div>
          <small>
            Automatico: links http:// e servidores sem CORS passam pelo proxy; o resto vai direto. “Nunca” so funciona se o
            servidor IPTV for https e liberar CORS.
          </small>
        </div>
        <label className="tv-field">
          <span>Endereco do proxy</span>
          <input value={settings.proxyBase} onChange={(event) => update({ proxyBase: event.target.value })} placeholder="/api/proxy" />
          <small>
            Padrao: <code>/api/proxy</code> (funcao da Vercel, limite de 5 min por conexao — o gravador reconecta sozinho). Para
            gravacoes longas sem gastar trafego da Vercel, rode <code>npm run proxy</code> no PC e use{' '}
            <code>http://localhost:8787/api/proxy</code>.
          </small>
        </label>
        <div className="tv-actions left">
          <button type="button" className="tv-btn ghost small" onClick={() => void testProxy()}>
            {test.state === 'running' ? <Loader2 size={14} className="tv-spin" /> : null} Testar proxy
          </button>
          {test.state === 'ok' && (
            <span className="tv-ok">
              <CheckCircle2 size={14} /> {test.message}
            </span>
          )}
          {test.state === 'fail' && (
            <span className="tv-error">
              <XCircle size={14} /> {test.message}
            </span>
          )}
          <button type="button" className="tv-btn ghost small" onClick={() => update({ proxyBase: DEFAULT_SETTINGS.proxyBase })}>
            Restaurar padrao
          </button>
        </div>
        <label className="tv-field">
          <span>User-Agent enviado ao servidor IPTV (via proxy)</span>
          <input value={settings.userAgent} onChange={(event) => update({ userAgent: event.target.value })} placeholder="VLC/3.0.21 LibVLC/3.0.21" />
          <small>Alguns provedores so aceitam certos apps. Deixe vazio para usar o do VLC.</small>
        </label>
      </div>

      <div className="tv-card">
        <h3>Dados</h3>
        <p className="tv-muted">Playlists, senhas e agendamentos ficam salvos apenas neste navegador.</p>
        <button type="button" className="tv-btn ghost" onClick={() => void clearCaches()}>
          Limpar cache de listas e EPG
        </button>
      </div>
    </div>
  )
}
