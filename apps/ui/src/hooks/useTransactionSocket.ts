import {useEffect, useRef} from 'react'

import {useWebSocketToken} from './useWebSocketToken'

// Callback-based WebSocket subscription so 30 Hz transaction pings never trigger React re-renders.
export function useTransactionSocket(onTxPing: (count: number) => void): void {
	const {data} = useWebSocketToken()
	const onTxPingRef = useRef(onTxPing)
	onTxPingRef.current = onTxPing

	useEffect(() => {
		if (!data?.token) return

		const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/ws/transactions?token=${data.token}`)

		ws.onmessage = (e) => {
			if (document.hidden) return
			try {
				// The backend sends one “txPing” frame every 33 ms, with
				// `count` = number of transactions in that slice.
				const {type, count = 1} = JSON.parse(e.data)
				if (type === 'txPing' && count > 0) onTxPingRef.current(count)
			} catch {
				// fallback for unexpected payloads
				onTxPingRef.current(1)
			}
		}

		// In dev, React StrictMode double-invokes effects (mount → unmount → mount).
		// The first unmount closes the WebSocket before it connects, triggering a
		// harmless "WebSocket is closed before the connection is established" error.
		// This does not happen in production.
		ws.onerror = console.error
		return () => {
			ws.onmessage = null
			ws.onerror = null
			ws.close()
		}
	}, [data?.token])
}
