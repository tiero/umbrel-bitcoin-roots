import {useQuery} from '@tanstack/react-query'

import {api} from '@/lib/api'

import type {ConnectionDetails} from '#types'

export function useConnectionDetails(enabled = true) {
	return useQuery({
		queryKey: ['connect', 'details'],
		queryFn: () => api<ConnectionDetails>('/connect/details'),
		enabled,
		staleTime: 60_000,
		refetchInterval: enabled ? 60_000 : false,
	})
}
