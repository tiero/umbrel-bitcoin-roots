import {useQuery} from '@tanstack/react-query'
import {api} from '@/lib/api'
import {syncStage, type SyncStage} from '@/lib/sync-progress'
import type {SyncStatus} from '#types'

const SYNC_QUERY_OPTIONS = {
	queryKey: ['rpc', 'sync'] as const,
	queryFn: () => api<SyncStatus>('/rpc/sync'),
	// Poll every 2s during IBD/headers so progress feels live, then back off to 30s once synced
	// (new blocks already arrive immediately via WebSocket in useBlockStream).
	refetchInterval: (query: {state: {data?: SyncStatus}}) => (syncStage(query.state.data) === 'synced' ? 30_000 : 2_000),
	staleTime: 5_000,
}

export function useSyncStatus() {
	return useQuery(SYNC_QUERY_OPTIONS)
}

// Selector hook that only re-renders callers when the discrete sync stage string changes.
export function useSyncStage(): SyncStage {
	const {data} = useQuery({
		...SYNC_QUERY_OPTIONS,
		select: (status) => syncStage(status),
	})
	return data ?? 'loading'
}
