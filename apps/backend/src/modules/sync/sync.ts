import {rpcClient} from '../bitcoind/rpc-client.js'

import type {SyncStatus} from '#types'

export async function syncStatus(): Promise<SyncStatus> {
	const info = await rpcClient.cachedCommand<{
		verificationprogress: number
		initialblockdownload: boolean
		blocks: number
		headers: number
	}>(2_000, 'getblockchaininfo')
	return {
		syncProgress: info.verificationprogress,
		isInitialBlockDownload: info.initialblockdownload,
		blockHeight: info.blocks,
		validatedHeaderHeight: info.headers,
	}
}
