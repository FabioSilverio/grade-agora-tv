import { useMemo } from 'react'
import { useLocalService } from './localService'
import { isActive, useRecordings } from './recorder'
import type { RecordingInfo } from './types'

export type ActiveRecording = RecordingInfo & { where: 'browser' | 'pc' }

/** Gravacoes em andamento no navegador e no gravador do PC. */
export function useActiveRecordings(): ActiveRecording[] {
  const browser = useRecordings()
  const local = useLocalService()
  return useMemo(
    () => [
      ...browser.filter(isActive).map((info) => ({ ...info, where: 'browser' as const })),
      ...(local.available ? (local.recordings?.active ?? []) : []).map((info) => ({ ...info, where: 'pc' as const })),
    ],
    [browser, local],
  )
}
