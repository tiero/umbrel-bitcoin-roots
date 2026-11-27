import {useRef, useEffect, useMemo} from 'react'
import {useSyncStatus} from '@/hooks/useSyncStatus'
import {syncStage} from '@/lib/sync-progress'

// Hook to track sync progress without re-renders
export function useSyncProgress() {
	const {data: syncStatus} = useSyncStatus()
	const currentHeightRef = useRef(0)
	const targetHeightRef = useRef(0)
	const lastUpdateRef = useRef(0)
	const stage = syncStage(syncStatus)

	useEffect(() => {
		if (syncStatus?.blockHeight) {
			targetHeightRef.current = syncStatus.blockHeight
		}
	}, [syncStatus?.blockHeight])

	// Return stable memoized object so AnimatedCube doesn't re-run sync effects every poll
	return useMemo(
		() => ({
			currentHeightRef,
			targetHeightRef,
			lastUpdateRef,
			stage,
			syncStatus,
		}),
		[stage, syncStatus],
	)
}
