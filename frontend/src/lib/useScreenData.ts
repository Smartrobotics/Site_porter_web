import { useEffect } from 'react'
import { useStore } from '../domain/store'
import { fetchWithTimeout } from './http'

const SCREEN_CHECK_TIMEOUT_MS = 5_000

export function useScreenData() {
  const { reportScreenLoadFailed } = useStore()
  useEffect(() => {
    let cancelled = false
    fetchWithTimeout('/api/health', undefined, SCREEN_CHECK_TIMEOUT_MS)
      .then((res) => {
        if (!cancelled && !res.ok) reportScreenLoadFailed()
      })
      .catch(() => {
        if (!cancelled) reportScreenLoadFailed()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
