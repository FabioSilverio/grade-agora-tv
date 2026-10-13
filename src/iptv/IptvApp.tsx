import {
  CalendarClock,
  CalendarDays,
  Clapperboard,
  Disc,
  Film,
  ListVideo,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Tv,
  TvMinimalPlay,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { GuideView } from './components/GuideView'
import { LiveView } from './components/LiveView'
import { PlaylistManager } from './components/PlaylistManager'
import { RecordingsView } from './components/RecordingsView'
import { RuleEditorHost } from './components/RuleEditor'
import { ScheduleView } from './components/ScheduleView'
import { SettingsView } from './components/SettingsView'
import { MoviesView, SeriesView } from './components/VodView'
import { warmEpg } from './epg'
import { useActiveRecordings } from './activeRecordings'
import { initLocalService, useLocalService } from './localService'
import { refreshFolderState, useFolderState } from './recorder'
import { initScheduler } from './scheduler'
import { store, useAppState } from './state'
import { usePlaylistData } from './hooks'
import './iptv.css'

type Tab = 'live' | 'guide' | 'movies' | 'series' | 'recordings' | 'schedule' | 'settings'

const TABS: Array<{ id: Tab; label: string; icon: typeof Tv }> = [
  { id: 'live', label: 'Ao vivo', icon: Tv },
  { id: 'guide', label: 'Guia', icon: CalendarDays },
  { id: 'movies', label: 'Filmes', icon: Film },
  { id: 'series', label: 'Series', icon: Clapperboard },
  { id: 'recordings', label: 'Gravacoes', icon: Disc },
  { id: 'schedule', label: 'Agenda', icon: CalendarClock },
  { id: 'settings', label: 'Ajustes', icon: SettingsIcon },
]

function tabFromHash(): Tab {
  const value = location.hash.replace(/^#\/?/, '') as Tab
  return TABS.some((tab) => tab.id === value) ? value : 'live'
}

export function IptvApp() {
  const [tab, setTabState] = useState<Tab>(tabFromHash)
  const [managerOpen, setManagerOpen] = useState(false)
  const playlists = useAppState((state) => state.playlists)
  const activeId = useAppState((state) => state.activePlaylistId)
  const { data, loading, error, reload } = usePlaylistData(activeId)
  const [channelId, setChannelId] = useState<string | null>(() => (activeId ? localStorage.getItem(`iptv:last:${activeId}`) : null))
  const activeRecordings = useActiveRecordings()
  const local = useLocalService()
  const folder = useFolderState()
  const recordingCount = activeRecordings.length
  const browserRecording = activeRecordings.some((item) => item.where === 'browser')

  useEffect(() => {
    initScheduler()
    initLocalService()
    void refreshFolderState()
    const onHash = () => setTabState(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (activeId) warmEpg(activeId)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChannelId(activeId ? localStorage.getItem(`iptv:last:${activeId}`) : null)
  }, [activeId])

  const setTab = (next: Tab) => {
    window.location.assign(`#/${next}`)
    setTabState(next)
  }

  const watch = useCallback(
    (id: string) => {
      setChannelId(id)
      if (activeId) localStorage.setItem(`iptv:last:${activeId}`, id)
      if (location.hash !== '#/live') window.location.assign('#/live')
      setTabState('live')
    },
    [activeId],
  )

  const needsPlaylist = ['live', 'guide', 'movies', 'series'].includes(tab)

  return (
    <div className="tv-app">
      <header className="tv-header">
        <div className="tv-brand">
          <span className="tv-brand-mark">
            <TvMinimalPlay size={20} />
          </span>
          <div>
            <strong>Grade Agora TV</strong>
            <small>Player IPTV</small>
          </div>
        </div>

        <nav className="tv-tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={16} />
              <span>{label}</span>
              {id === 'recordings' && recordingCount > 0 && <em className="tv-rec-count">{recordingCount}</em>}
            </button>
          ))}
        </nav>

        <div className="tv-header-right">
          {playlists.length > 0 && (
            <select
              className="tv-playlist-select"
              value={activeId ?? ''}
              onChange={(event) => store.set({ activePlaylistId: event.target.value })}
              title="Playlist ativa"
            >
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="tv-icon-btn" onClick={() => void reload()} title="Recarregar lista do provedor" disabled={!activeId}>
            <RefreshCw size={17} className={loading ? 'tv-spin' : ''} />
          </button>
          <button type="button" className="tv-btn small" onClick={() => setManagerOpen(true)}>
            <ListVideo size={15} /> Playlists
          </button>
          <a className="tv-btn small ghost" href="#/grade" title="Grade de TV aberta e fechada">
            <CalendarDays size={15} /> Grade TV
          </a>
        </div>
      </header>

      {recordingCount > 0 && tab !== 'recordings' && (
        <button type="button" className="tv-rec-banner" onClick={() => setTab('recordings')}>
          <span className="tv-rec-dot" /> {recordingCount} gravacao(oes) em andamento{browserRecording ? ' — mantenha esta aba aberta' : ' no gravador do PC'}
        </button>
      )}
      {!local.available && folder.name && folder.permission === 'prompt' && store.get().rules.some((rule) => rule.enabled) && (
        <button type="button" className="tv-rec-banner warn" onClick={() => setTab('recordings')}>
          A pasta de gravacoes precisa ser reautorizada. Clique aqui.
        </button>
      )}

      <main className="tv-content">
        {needsPlaylist && !playlists.length && (
          <div className="tv-onboarding">
            <h1>Bem-vindo ao Grade Agora TV</h1>
            <p className="tv-muted">
              Adicione sua lista IPTV (M3U ou Xtream Codes) para assistir no PC e agendar gravacoes pela EPG — inclusive todo dia no
              horario do programa.
            </p>
            <div className="tv-card">
              <PlaylistManager startWithForm />
            </div>
          </div>
        )}

        {needsPlaylist && playlists.length > 0 && !data && (
          <div className="tv-loading">
            {error ? (
              <>
                <p className="tv-error">{error}</p>
                <div className="tv-actions">
                  <button type="button" className="tv-btn" onClick={() => void reload()}>
                    Tentar de novo
                  </button>
                  <button type="button" className="tv-btn ghost" onClick={() => setManagerOpen(true)}>
                    Editar playlist
                  </button>
                </div>
              </>
            ) : (
              <>
                <Loader2 size={30} className="tv-spin" />
                <p>Carregando canais...</p>
              </>
            )}
          </div>
        )}

        {data && activeId && tab === 'live' && <LiveView playlistId={activeId} data={data} channelId={channelId} onChannel={watch} />}
        {data && activeId && tab === 'guide' && <GuideView playlistId={activeId} data={data} onWatch={watch} />}
        {data && tab === 'movies' && <MoviesView data={data} />}
        {data && activeId && tab === 'series' && <SeriesView playlistId={activeId} data={data} />}
        {tab === 'recordings' && <RecordingsView />}
        {tab === 'schedule' && <ScheduleView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      {managerOpen && <PlaylistManager onClose={() => setManagerOpen(false)} />}
      <RuleEditorHost />
    </div>
  )
}
