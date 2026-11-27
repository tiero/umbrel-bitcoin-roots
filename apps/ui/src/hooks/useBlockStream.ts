import {useEffect} from 'react'
import {useQueryClient} from '@tanstack/react-query'

import {useWebSocketToken} from './useWebSocketToken'
import {useSyncStage} from './useSyncStatus'

import type {Block} from '#types'

// Single global WebSocket for real-time block updates.
// Call once in the app shell (Layout). On new block, updates every
// ['rpc', 'blocks', *] query cache so all consumers (home page cubes,
// insights charts) stay in sync without their own WebSocket connections.

export function useBlockStream() {
	const qc = useQueryClient()
	const stage = useSyncStage()
	const {data: tokenData} = useWebSocketToken()

	useEffect(() => {
		if (stage !== 'synced' || !tokenData?.token) return

		let ws: WebSocket | undefined
		let retry = 0
		let retryTimer: ReturnType<typeof setTimeout> | undefined
		let cancelled = false

		const open = () => {
			ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/ws/blocks?token=${tokenData.token}`)

			ws.onopen = () => {
				retry = 0
			}

			ws.onmessage = (ev) => {
				try {
					const block: Block = JSON.parse(ev.data)

					// Update every ['rpc', 'blocks', *] cache (limit=5, limit=200, etc.)
					qc.setQueriesData<Block[]>({queryKey: ['rpc', 'blocks']}, (old) => {
						if (!old) return old
						if (old.some((b) => b.hash === block.hash)) return old
						// Maintain oldest-first order (matching REST response)
						return [...old, block].sort((a, b) => a.height - b.height).slice(-old.length)
					})
				} catch {
					/* ignore bad JSON */
				}
			}

			ws.onclose = () => {
				if (cancelled) return
				retry = Math.min(retry + 1, 6)
				retryTimer = globalThis.setTimeout(open, 1_000 * 2 ** (retry - 1))
			}
			ws.onerror = () => ws?.close()
		}

		open()
		return () => {
			cancelled = true
			clearTimeout(retryTimer)
			if (ws) {
				ws.onopen = null
				ws.onmessage = null
				ws.onclose = null
				ws.onerror = null
				ws.close()
			}
		}
	}, [stage, qc, tokenData?.token])
}
