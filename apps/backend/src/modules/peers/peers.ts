import {rpcClient} from '../bitcoind/rpc-client.js'

import {ipToLatLng, lookupPublicIpLatLng} from './ip-to-location.js'

import type {PeerInfo, PeerCount, PeerLocation, PeerLocationsResponse} from '#types'

// Cached getpeerinfo response (5s TTL + in-flight deduplication)
const getPeerInfoRPC = () => rpcClient.cachedCommand<PeerInfo[]>(5_000, 'getpeerinfo')

type NetworkInfoLocalAddress = {address: string; port: number; score: number}
type NetworkInfoPartial = {localaddresses?: NetworkInfoLocalAddress[]}
const getNetworkInfoRPC = () => rpcClient.cachedCommand<NetworkInfoPartial>(30_000, 'getnetworkinfo')

// Raw bitcoind getpeerinfo response
export async function peerInfo(): Promise<PeerInfo[]> {
	return getPeerInfoRPC()
}

// Count peers by network + direction (incoming vs outgoing)
export async function peerCount(): Promise<PeerCount> {
	const peers = await getPeerInfoRPC()

	// network can be ipv4, ipv6, onion, i2p, cjdns, not_publicly_routable
	const summary: PeerCount = {total: peers.length, byNetwork: {}}

	for (const p of peers) {
		const bucket = (summary.byNetwork[p.network] ??= {inbound: 0, outbound: 0, total: 0})

		if (p.inbound) bucket.inbound++
		else bucket.outbound++

		bucket.total++
	}

	return summary
}

// Extracts the host part of an address (e.g. `"10.0.0.2:52344"` → `"10.0.0.2" or `"[2001:db8::1]:8333"` → `"2001:db8::1"`)
function hostFromAddr(addr: string): string {
	// 1. optional leading '[' for IPv6
	// 2. capture everything up to the final ':' (the port delimiter)
	// 3. optional closing ']'
	return addr.replace(/^\[?([^\]]+?)]?:\d+$/, '$1')
}

// Geolocated (or faked) latitude and longitude for each peer and the user
export async function peerLocations(): Promise<PeerLocationsResponse> {
	const peerInfo = await getPeerInfoRPC()

	// peer locations
	const peers: PeerLocation[] = peerInfo.map((p) => {
		const host = hostFromAddr(p.addr)
		return {
			addr: host,
			network: p.network,
			location: ipToLatLng(host, p.network),
		}
	})

	// user location
	const hostTally = new Map<string, number>()

	for (const peer of peerInfo) {
		const {addrlocal, network} = peer

		// `addrlocal` appears only on clearnet connections
		if (!addrlocal) continue
		if (network !== 'ipv4' && network !== 'ipv6') continue // sanity check even though it should't exist on non-clearnet networks

		const host = hostFromAddr(addrlocal)
		hostTally.set(host, (hostTally.get(host) ?? 0) + 1)
	}

	// Pick the most-frequent public addrlocal that actually geolocates (never let a private/Docker
	// IP win and hash to a random fallback city).
	const rankedHosts = [...hostTally.entries()].sort((a, b) => b[1] - a[1])
	let userLocation: [number, number] | null = null
	for (const [host] of rankedHosts) {
		const geo = lookupPublicIpLatLng(host)
		if (geo) {
			userLocation = geo
			break
		}
	}

	// Secondary check: bitcoind's discovered external localaddresses (sorted by score)
	if (!userLocation) {
		try {
			const netInfo = await getNetworkInfoRPC()
			const locals = [...(netInfo.localaddresses ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
			for (const entry of locals) {
				const geo = lookupPublicIpLatLng(entry.address)
				if (geo) {
					userLocation = geo
					break
				}
			}
		} catch {
			// Ignore transient RPC errors; fall through to default marker
		}
	}

	// Fallback to central South America default if user has no geolocatable clearnet IP
	return {userLocation: userLocation ?? [-15.7942, -47.8822], peers}
}
