import {useCallback} from 'react'
import {useQueryClient} from '@tanstack/react-query'

import type {Block, Stats, PeerInfo} from '#types'

import {api} from '@/lib/api'

const NUM_BLOCKS = 200
const PREFETCH_STALE_MS = 15_000

/**
 * Returns an on-demand prefetcher for the Insights route (JS chunk + RPC queries).
 * Triggered on hover/focus of the Insights dock tab instead of eagerly firing
 * a 200-block RPC query on every Home/Settings page load.
 */
export function usePrefetchInsights() {
	const queryClient = useQueryClient()

	return useCallback(() => {
		void import('@/pages/insights')

		void queryClient.prefetchQuery({
			queryKey: ['rpc', 'stats'],
			queryFn: () => api<Stats>('/rpc/stats'),
			staleTime: PREFETCH_STALE_MS,
		})
		void queryClient.prefetchQuery({
			queryKey: ['rpc', 'blocks', NUM_BLOCKS],
			queryFn: () => api<Block[]>(`/rpc/blocks?limit=${NUM_BLOCKS}`),
			staleTime: PREFETCH_STALE_MS,
		})
		void queryClient.prefetchQuery({
			queryKey: ['rpc', 'peers', 'info'],
			queryFn: () => api<PeerInfo[]>('/rpc/peers/info'),
			staleTime: PREFETCH_STALE_MS,
		})
	}, [queryClient])
}
