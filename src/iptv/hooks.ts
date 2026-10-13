import { useCallback, useEffect, useState } from 'react'
import { getPlaylistData, onPlaylistUpdated } from './playlists'
import { getPlaylist } from './state'
import type { PlaylistData } from './types'

// ---------- hooks ----------

export function usePlaylistData(playlistId: string | null) {
  const [state, setState] = useState<{ id: string | null; data: PlaylistData | null; loading: boolean; error: string | null }>({
    id: null,
    data: null,
    loading: false,
    error: null,
  })

  const load = useCallback(
    async (force = false) => {
      const config = getPlaylist(playlistId)
      if (!config) {
        setState({ id: playlistId, data: null, loading: false, error: null })
        return
      }
      setState((current) => ({ id: playlistId, data: current.id === playlistId ? current.data : null, loading: true, error: null }))
      try {
        const data = await getPlaylistData(config, { force })
        setState({ id: playlistId, data, loading: false, error: null })
      } catch (error) {
        setState((current) => ({
          ...current,
          id: playlistId,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
    },
    [playlistId],
  )

  useEffect(() => {
    void load()
    return onPlaylistUpdated((id) => {
      if (id === playlistId) void load()
    })
  }, [load, playlistId])

  const current = state.id === playlistId ? state : { id: playlistId, data: null, loading: Boolean(playlistId), error: null }
  return { ...current, reload: () => load(true) }
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
