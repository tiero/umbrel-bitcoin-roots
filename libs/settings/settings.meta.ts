// This settings metadata file is used as a single source of truth for deriving the following:
// - validation schema per Bitcoin Core version (settings.schema.ts)
// - default settings values per Bitcoin Core version
// - The frontend settings page (React form inputs, descriptions, tool-tips, etc.)
// To add a new bitcoin.conf option, just add a new block to the `settingsMetadata` object and check that it is being written to the conf file correctly.

// Available Bitcoin Roots versions
// IMPORTANT:
// - Any version added here needs to be added in the Dockerfile
// - The array of versions must be newest → oldest. We do a simple index comparison to compare versions, so lower index = newer.
export const AVAILABLE_BITCOIN_CORE_VERSIONS = ['v30.3-roots.1'] as const

// Default Bitcoin Roots version used by bitcoind manager (always the newest version in the array)
export const DEFAULT_BITCOIN_CORE_VERSION = AVAILABLE_BITCOIN_CORE_VERSIONS[0]
export type BitcoinCoreVersion = (typeof AVAILABLE_BITCOIN_CORE_VERSIONS)[number]

export const LATEST = 'latest' as const
export const VERSION_CHOICES = [LATEST, ...AVAILABLE_BITCOIN_CORE_VERSIONS] as const
export type SelectedVersion = (typeof VERSION_CHOICES)[number]

// Tabs for organization (used in the UI to group settings)
export type Tab = 'peers' | 'policy' | 'optimization' | 'rpc-rest' | 'network' | 'version' | 'advanced'

interface BaseOption {
	tab: Tab
	label: string
	// we may want to make this optional in the future if we create settings that don't have a bitcoin label
	bitcoinLabel: string
	description: string
	subDescription?: string
}

interface NumberOption extends BaseOption {
	kind: 'number'
	min?: number
	max?: number
	step?: number
	default: number
	unit?: string
}

interface BooleanOption extends BaseOption {
	kind: 'toggle' // rendered as a Switch
	default: boolean
	disabledWhen?: Record<string, (v: unknown) => boolean>
	disabledMessage?: string
}

interface SelectOption extends BaseOption {
	kind: 'select'
	options: {value: string; label: string; selectable?: boolean}[]
	default: string
}

interface MultiOption extends BaseOption {
	kind: 'multi'
	options: {value: string; label: string}[]
	default: string[]
	requireAtLeastOne: boolean
}

export type Option = NumberOption | BooleanOption | SelectOption | MultiOption

// Optional per-version differences (overrides) for rule fields
// e.g., if the default value for a setting changes between Core versions, we can override the default value for specific versions.
type VersionOverrides = Partial<{
	default: unknown
	min: number
	max: number
	step: number
	unit: string
	options: {value: string; label: string}[]
	requireAtLeastOne: boolean
	disabledWhen: Record<string, (v: unknown) => boolean>
	disabledMessage: string
}>

// VersionedOption adds version-awareness on top of Option:
// - introducedIn is inclusive (i.e., available from this version and newer)
// - removedIn is exclusive (i.e., not available starting with this version)
// - versionOverrides carries tiny per-version diffs for rule fields only
export type VersionedOption = Option & {
	introducedIn?: BitcoinCoreVersion // inclusive
	removedIn?: BitcoinCoreVersion // exclusive
	versionOverrides?: Partial<Record<BitcoinCoreVersion, VersionOverrides>>
}

// NOTE: this is the single source of truth for the settings metadata. Everything is derived from this object (versioned metadata, versioned schema, default values, UI fields, etc).
// TypeScript infers the type of the object literals below based on the `kind` property.
export const settingsMetadata = {
	/* ===== Peers tab ===== */
	onlynet: {
		tab: 'peers',
		kind: 'multi',
		label: 'Outgoing Peer Connections',
		bitcoinLabel: 'onlynet',
		description: 'Select which networks you will use for outgoing peer connections.',
		options: [
			{value: 'clearnet', label: 'Clearnet'},
			{value: 'tor', label: 'Tor'},
			{value: 'i2p', label: 'I2P'},
		],
		default: ['clearnet', 'tor', 'i2p'],
		requireAtLeastOne: true,
	},

	proxy: {
		tab: 'peers',
		kind: 'toggle',
		label: 'Make All Outgoing Connections to Clearnet Peers Over Tor',
		bitcoinLabel: 'proxy',
		description:
			'Connect to peers available on the clearnet via Tor to preserve your anonymity at the cost of slightly less security.',
		default: false,
		// both clearnet and tor must be enabled to toggle this on
		disabledWhen: {
			onlynet: (v: unknown) => {
				const onlynets = v as string[]
				return !onlynets.includes('clearnet') || !onlynets.includes('tor')
			},
		},
		disabledMessage: 'Both Clearnet and Tor outgoing connections must be enabled to enable this',
	},

	listen: {
		tab: 'peers',
		kind: 'multi',
		label: 'Incoming Peer Connections',
		bitcoinLabel: 'listen, listenonion, i2pacceptincoming',
		// description:
		// 	'Allow other nodes to connect to your node. If you disable this, your node will only connect to other nodes on the network.',
		description:
			'Select which networks you will allow incoming peer connections from. This will broadcast your node to the Bitcoin network to help other nodes access the blockchain. You may need to set up port forwarding on your router to allow incoming connections from clearnet-only peers.',
		options: [
			{value: 'clearnet', label: 'Clearnet'},
			{value: 'tor', label: 'Tor'},
			{value: 'i2p', label: 'I2P'},
		],
		// By default we do not listen for incoming connections
		default: [],
		requireAtLeastOne: false,
	},

	// -natpmp is enabled by default as of Bitcoin Core v30.
	// This means that nodes with -listen enabled but running behind a firewall, such as a local network router, will be reachable if the firewall/router supports any of the PCP or NAT-PMP protocols (without needing to port forward).
	// NAT‑PMP uses UDP 5351 to the LAN router; but we run in Docker bridge mode so these packets hit the Docker bridge/NAT gateway, not the router, so no mapping is created from inside the container.
	// TODO: If umbrelOS adds a way to keep bridge mode but proxy required packets, we can expose this setting (default to `false`) so users with PCP/NAT‑PMP routers can opt in and not have to manually port forward.
	// natpmp: {
	// 	tab: 'peers',
	// 	kind: 'toggle',
	// 	label: 'Enable NAT-PMP Port Mapping',
	// 	bitcoinLabel: 'natpmp',
	// 	description:
	// 		'Automatically request port forwarding from your router using PCP or NAT-PMP for inbound P2P connections on clearnet. Requires a PCP/NAT-PMP capable router and may not work on all networks. Requires a NAT-PMP capable router and may not work on all networks.',
	// 	subDescription:
	// 		'Note: This does not affect Tor or I2P. If disabled, you can still forward ports manually on your router.',
	// 	// Bitcoin Core default is false
	// 	default: false,
	// },

	peerblockfilters: {
		tab: 'peers',
		kind: 'toggle',
		label: 'Peer Block Filters',
		bitcoinLabel: 'peerblockfilters',
		description:
			'Share compact block filter data with connected light clients (like wallets) connected to your node, allowing them to get only the transaction information they are interested in from your node without having to download the entire blockchain. Enabling this will automatically enable Block Filter Index below.',
		subDescription:
			'⚠ This setting requires Block Filter Index to be enabled (this will be enforced automatically when you save with this setting enabled). If you disable Peer Block Filters, you will need to also manually toggle off Block Filter Index if you want to stop storing block filter data.',
		// Bitcoind Core's default for this is false
		default: true,
	},

	// If Peer Block Filters is enabled, then this will get automatically enabled when the config is written.
	blockfilterindex: {
		tab: 'peers',
		kind: 'toggle',
		label: 'Block Filter Index',
		bitcoinLabel: 'blockfilterindex',
		description:
			'Store an index of compact block filters which allows faster wallet re-scanning. In order to serve compact block filters to peers, you must also enable Peer Block Filters above.',
		subDescription:
			'⚠ To use Block Filter Index with a pruned node, you must enable it when you start the Prune Old Blocks process under the Optimization category. If your node is already pruned and Block Filter Index is off, enabling it will prevent your node from starting. To fix this while keeping Block Filter Index on, you will need to either reindex your node or turn off Prune Old Blocks.',
		// Bitcoind Core's default for this is false
		default: true,
	},

	peerbloomfilters: {
		tab: 'peers',
		kind: 'toggle',
		label: 'Peer Bloom Filters',
		bitcoinLabel: 'peerbloomfilters',
		description:
			'Enable support for BIP37, a feature used by older light clients (like wallets) to get only the transaction information they are interested in from your node without having to download the entire blockchain.',
		subDescription:
			'⚠ Bloom filters can have privacy and denial-of-service (DoS) risks, especially if your node is publicly reachable; its use is discouraged in favour of the more modern compact block filters.',
		default: false,
	},

	bantime: {
		tab: 'peers',
		kind: 'number',
		label: 'Peer Ban Time',
		bitcoinLabel: 'bantime',
		description:
			"Set the duration (in seconds) that a peer will be banned from connecting to your node if they violate protocol rules or exhibit suspicious behavior. By adjusting bantime, you can maintain your node's security and network integrity, while preventing repeat offenders from causing disruptions. A longer bantime increases the ban period, discouraging misbehavior, while a shorter bantime allows for quicker reconnections but may require more frequent manual monitoring of peer activity.",
		step: 1,
		default: 86_400,
		unit: 'sec',
	},

	maxconnections: {
		tab: 'peers',
		kind: 'number',
		label: 'Max Peer Connections',
		bitcoinLabel: 'maxconnections',
		// TODO: maybe talk about outgoing vs incoming here
		description:
			"Set the maximum number of peers your node can connect to simultaneously. By managing this, you can optimize your node's network usage and system resources based on your device's capacity. A higher value enables your node to maintain more connections, potentially improving network stability and data sharing. A lower value conserves system resources and bandwidth, which may be beneficial for devices with limited capabilities.",
		step: 1,
		default: 125,
		unit: 'peers',
	},

	maxreceivebuffer: {
		tab: 'peers',
		kind: 'number',
		label: 'Max Receive Buffer',
		bitcoinLabel: 'maxreceivebuffer',
		description:
			'Set the maximum amount of memory (in kilobytes) allocated for storing incoming data from other nodes in the network. A larger buffer size allows your node to handle more incoming data simultaneously, while a smaller size reduces memory consumption but may limit the amount of data your node can process at once.',
		step: 1,
		default: 5000,
		unit: 'KB',
	},

	maxsendbuffer: {
		tab: 'peers',
		kind: 'number',
		label: 'Max Send Buffer',
		bitcoinLabel: 'maxsendbuffer',
		description:
			'Set the maximum memory (in kilobytes) dedicated to storing outgoing data sent to other nodes in the network. A larger buffer size enables your node to send more data simultaneously, while a smaller size conserves memory but may restrict the volume of data your node can transmit at once.',
		step: 1,
		default: 5000,
		unit: 'KB',
	},

	// maxtimeadjustment - no longer in bitcoind -help-debug
	// https://github.com/bitcoin/bitcoin/pull/28956

	peertimeout: {
		tab: 'peers',
		kind: 'number',
		label: 'Peer Timeout',
		bitcoinLabel: 'peertimeout',
		description:
			"Set the maximum time (in seconds) that your node will wait for a response from a connected peer before considering it unresponsive and disconnecting. Adjusting peertimeout helps you maintain stable connections with responsive peers while ensuring your node doesn't waste resources on unresponsive ones. A shorter timeout value allows for quicker disconnection from unresponsive peers, while a longer timeout provides more time for slow-responding peers to maintain a connection.",
		step: 1,
		min: 1,
		default: 60,
		unit: 'sec',
	},

	timeout: {
		tab: 'peers',
		kind: 'number',
		label: 'Connection Timeout',
		bitcoinLabel: 'timeout',
		description:
			'Set the maximum time (in seconds) that your node will wait for a response from a newly connecting peer during the initial handshake process before considering it unresponsive and disconnecting. Fine-tuning it helps you ensure your node establishes stable connections with responsive peers while avoiding unresponsive ones. A shorter timeout value leads to faster disconnection from unresponsive peers, while a longer timeout allows more time for slow-responding peers to complete the handshake.',
		step: 1,
		min: 1,
		default: 5000,
		unit: 'ms',
	},

	maxuploadtarget: {
		tab: 'peers',
		kind: 'number',
		label: 'Max Upload Target',
		bitcoinLabel: 'maxuploadtarget',
		description:
			"Limit the maximum amount of data (in MB) your node will upload to other peers in the network within a 24-hour period. Setting this to 0 (default) means that there is no limit. By adjusting it, you can optimize your node's bandwidth usage and maintain a balance between sharing data with the network and conserving your internet resources. A higher upload target allows your node to contribute more data to the network, while a lower target helps you save bandwidth for other uses.",
		subDescription:
			'⚠ Peers that are whitelisted are exempt from this limit. By default, your node whitelists apps on your Umbrel (e.g., Electrs). However, external apps and wallets that are connected via the P2P port may fail to receive data from your node if your node hits the 24-hour upload limit.',
		min: 0,
		step: 1,
		default: 0,
		unit: 'MB/24h',
	},

	/* ===== optimizationization tab ===== */
	dbcache: {
		tab: 'optimization',
		kind: 'number',
		label: 'Cache Size',
		bitcoinLabel: 'dbcache',
		description:
			'Choose the size of the UTXO set to store in RAM. A larger cache can speed up the initial synchronization of your Bitcoin node, but after the initial sync is complete, a larger cache value does not significantly improve performance and may use more RAM than needed.',
		min: 4,
		// We don't set the max here because bitcoind will just automatically cap at 16_384 without erroring
		// and this max value has traditionally increased over time with newer releases
		// max: 16_384,
		step: 1,
		// Bitcoin Core v31+ defaults to 1024 MiB when it detects at least 4 GiB of RAM, but warns that
		// containers may overestimate available memory. Keep 450 MiB for Umbrel's shared app environment.
		// TODO: Revisit whether Umbrel should keep overriding Bitcoin Core's version- and hardware-specific default.
		default: 450,
		unit: 'MiB',
	},

	prune: {
		tab: 'optimization',
		kind: 'number',
		label: 'Prune Old Blocks',
		bitcoinLabel: 'prune',
		description:
			'Save storage space by pruning (deleting) old blocks and keeping only a limited copy of the blockchain. It may take some time for your node to become responsive after you turn on pruning.',
		subDescription:
			'⚠ Transaction Indexing (txindex) and Transaction Output Spender Index (txospenderindex) are incompatible with a pruned node and will be automatically disabled when you save with pruning enabled. Note that some connected apps and services may not work with a pruned blockchain. If you turn off pruning after turning it on, you will need to redownload the entire blockchain.',
		// bitcoind units are MiB, but we use GB here for UX
		// 1 MiB = allow manual pruning via RPC, >=550 MiB =
		// automatically prune block files to stay under the specified
		// target size in MiB
		// using GB and a step of 1 means users will never select between 1 MiB or <550 MiB behaviours described above
		default: 0, // 0 disables pruning
		step: 1,
		min: 0,
		unit: 'GB',
	},

	// TODO: should we delete the txindex dir when this is disabled?
	txindex: {
		tab: 'optimization',
		kind: 'toggle',
		label: 'Enable Transaction Indexing',
		bitcoinLabel: 'txindex',
		description: 'Enable transaction indexing to speed up transaction lookups.',
		subDescription:
			'⚠ Many connected apps and services will not work without txindex enabled, so make sure you understand the implications before disabling it. txindex is automatically disabled when pruning is enabled.',
		// bitcoin core default is false, but we our default is true
		default: true,
		/** UI hint: disable when prune > 0 */
		disabledWhen: {prune: (v: unknown) => (v as number) > 0},
		disabledMessage: 'automatically disabled when pruning is enabled',
	},

	/* ===== Relay & Mining Policy tab ===== */
	datacarrier: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Relay Data Carrier Transactions',
		bitcoinLabel: 'datacarrier',
		description: 'Relay and mine transactions containing data-carrier outputs (such as OP_RETURN).',
		default: true,
	},

	datacarriersize: {
		tab: 'policy',
		kind: 'number',
		label: 'Max Allowed Size of Data Carrier Outputs',
		bitcoinLabel: 'datacarriersize',
		description:
			'Set the maximum aggregate size (in bytes) of data-carrying scriptPubKeys that your node will relay and mine.',
		subDescription: 'Note: datacarrier must be enabled for this setting to take effect.',
		// Bitcoin Roots restores the pre-v30 conservative default of 83 bytes on the Core v30.3 base
		// (Bitcoin Core v30 raised the default to 100_000). The limit remains configurable up to the Core v30 max.
		// We never overwrite a users saved value, so only fresh installs will get initially set to this default.
		default: 83,
		min: 0,
		max: 100_000,
		step: 1,
		unit: 'bytes',
	},

	datacarriercost: {
		tab: 'policy',
		kind: 'number',
		label: 'Data Carrier Policy Weight Multiplier',
		bitcoinLabel: 'datacarriercost',
		description:
			'Treat each detected data-carrier byte as at least this many policy vbytes (rounded up to quarters of a vbyte). Raising this discourages data-heavy transactions relative to monetary payments.',
		default: 1,
		min: 0,
		max: 1_000_000,
		step: 0.25,
		unit: 'vB/B',
	},

	datacarrierfullcount: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Count All Data-Carrier Methods Toward Limit',
		bitcoinLabel: 'datacarrierfullcount',
		description: 'Apply the datacarriersize limit across all recognized data-carrier encodings, not only OP_RETURN.',
		default: true,
	},

	acceptnonstddatacarrier: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Accept Non-Standard Data Carrier Outputs',
		bitcoinLabel: 'acceptnonstddatacarrier',
		description: 'Relay and mine transactions with non-standard data-carrier outputs.',
		default: false,
	},

	permitbaredatacarrier: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Permit Bare Data Carrier Outputs',
		bitcoinLabel: 'permitbaredatacarrier',
		description: 'Relay data-carrier outputs that do not use OP_RETURN.',
		default: false,
	},

	rejectparasites: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Reject Parasitic Overlay Protocols',
		bitcoinLabel: 'rejectparasites',
		description: 'Refuse to relay or mine transactions identified as parasitic overlay protocols (such as CAT21).',
		default: true,
	},

	rejecttokens: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Reject Non-Bitcoin Token Transactions',
		bitcoinLabel: 'rejecttokens',
		description: 'Refuse to relay or mine transactions carrying non-bitcoin token protocols (such as Runes).',
		default: false,
	},

	permitbaremultisig: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Relay Bare Multisig Transactions',
		bitcoinLabel: 'permitbaremultisig',
		description: 'Relay transactions creating non-P2SH bare multisig outputs.',
		// Bitcoin Roots disables bare-multisig (and bare-pubkey) relay by default; Bitcoin Core defaults to true.
		default: false,
	},

	permitbarepubkey: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Relay Bare Pubkey Transactions',
		bitcoinLabel: 'permitbarepubkey',
		description: 'Relay legacy bare pay-to-pubkey (P2PK) outputs.',
		default: false,
	},

	permitbareanchor: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Relay Bare Ephemeral Anchor Transactions',
		bitcoinLabel: 'permitbareanchor',
		description: 'Relay transactions that only have ephemeral anchor outputs.',
		default: true,
	},

	permitephemeral: {
		tab: 'policy',
		kind: 'multi',
		label: 'Permit Ephemeral Policy Exceptions',
		bitcoinLabel: 'permitephemeral',
		description: 'Select which ephemeral output policy exceptions are permitted during mempool admission and relay.',
		options: [
			{value: 'anchor', label: 'Anchor'},
			{value: 'dust', label: 'Dust'},
			{value: 'send', label: 'Send'},
		],
		default: ['anchor'],
		requireAtLeastOne: false,
	},

	acceptunknownwitness: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Accept Unknown Witness Versions',
		bitcoinLabel: 'acceptunknownwitness',
		description: 'Relay transactions sending to unknown or future SegWit script versions.',
		default: true,
	},

	mempoolreplacement: {
		tab: 'policy',
		kind: 'select',
		label: 'Replace-By-Fee (RBF) Policy',
		bitcoinLabel: 'mempoolreplacement',
		description:
			'Control input-conflict replacement in the mempool: Full RBF allows replacing any unconfirmed transaction by fee, Opt-in RBF honors BIP125 / TRUC signaling, and Disabled rejects input-conflict replacements.',
		options: [
			{value: 'fee,-optin', label: 'Full RBF (fee,-optin)'},
			{value: 'fee,optin', label: 'Opt-in RBF (fee,optin)'},
			{value: '0', label: 'Disabled (0)'},
		],
		default: 'fee,-optin',
	},

	mempooltruc: {
		tab: 'policy',
		kind: 'select',
		label: 'TRUC (v3 Transaction) Policy',
		bitcoinLabel: 'mempooltruc',
		description:
			'Select how your node handles TRUC (version 3) transactions: enforce TRUC rules, accept without enforcing, or reject.',
		options: [
			{value: 'enforce', label: 'Enforce'},
			{value: 'accept', label: 'Accept'},
			{value: 'reject', label: 'Reject'},
		],
		default: 'enforce',
	},

	spkreuse: {
		tab: 'policy',
		kind: 'select',
		label: 'Script Reuse Policy',
		bitcoinLabel: 'spkreuse',
		description:
			'Control how your node treats unconfirmed transactions reusing the same output scriptPubKey: Allow permits reuse, while Conflict treats script reuse as a conflict.',
		options: [
			{value: 'allow', label: 'Allow'},
			{value: 'conflict', label: 'Reject conflicts'},
		],
		default: 'allow',
	},

	maxscriptsize: {
		tab: 'policy',
		kind: 'number',
		label: 'Maximum Script & Witness Size',
		bitcoinLabel: 'maxscriptsize',
		description: 'Maximum size of scripts (including the witness stack) your node will relay and mine.',
		default: 1650,
		min: 0,
		max: 4_294_967_295,
		step: 1,
		unit: 'bytes',
	},

	bytespersigop: {
		tab: 'policy',
		kind: 'number',
		label: 'Equivalent Bytes per SigOp',
		bitcoinLabel: 'bytespersigop',
		description: 'Equivalent virtual bytes counted per signature operation for relay and mining.',
		default: 20,
		min: 0,
		max: 4_294_967_295,
		step: 1,
		unit: 'B/sigop',
	},

	bytespersigopstrict: {
		tab: 'policy',
		kind: 'number',
		label: 'Strict Minimum Bytes per SigOp',
		bitcoinLabel: 'bytespersigopstrict',
		description: 'Minimum bytes per signature operation required in transactions your node relays and mines.',
		default: 20,
		min: 0,
		max: 4_294_967_295,
		step: 1,
		unit: 'B/sigop',
	},

	maxtxlegacysigops: {
		tab: 'policy',
		kind: 'number',
		label: 'Maximum Legacy SigOps per Transaction',
		bitcoinLabel: 'maxtxlegacysigops',
		description: 'Maximum number of legacy signature operations allowed in a single transaction for relay and mining.',
		default: 2500,
		min: 0,
		max: 4_294_967_295,
		step: 1,
		unit: 'sigops',
	},

	subdustfeepenalty: {
		tab: 'policy',
		kind: 'toggle',
		label: 'Sub-Dust Fee Penalty',
		bitcoinLabel: 'subdustfeepenalty',
		description: 'Subtract output dust deficits from modified policy fees during relay and mining selection.',
		default: true,
	},

	dustdynamic: {
		tab: 'policy',
		kind: 'select',
		label: 'Dynamic Dust Fee Rate',
		bitcoinLabel: 'dustdynamic',
		description:
			'Automatically raise the dust threshold based on estimated confirmation fees (target blocks) or your mempool fee rate at a given depth (kvB).',
		options: [
			{value: 'off', label: 'Off'},
			{value: 'target:2', label: 'Target 2 blocks'},
			{value: 'target:6', label: 'Target 6 blocks'},
			{value: 'target:12', label: 'Target 12 blocks'},
			{value: 'target:24', label: 'Target 24 blocks'},
			{value: 'mempool:1000', label: 'Mempool top 1,000 kvB'},
			{value: 'mempool:5000', label: 'Mempool top 5,000 kvB'},
			{value: 'mempool:10000', label: 'Mempool top 10,000 kvB'},
		],
		default: 'off',
	},

	minrelaycoinblocks: {
		tab: 'policy',
		kind: 'number',
		label: 'Minimum Coin-Blocks to Relay',
		bitcoinLabel: 'minrelaycoinblocks',
		description:
			'Minimum coin-blocks (BTC × blocks confirmed) a transaction must spend to be relayed. Set to 0 to disable.',
		default: 0,
		min: 0,
		max: 1_000_000_000,
		step: 1,
		unit: 'coin-blocks',
	},

	minrelaymaturity: {
		tab: 'policy',
		kind: 'number',
		label: 'Minimum Input Maturity to Relay',
		bitcoinLabel: 'minrelaymaturity',
		description:
			'Minimum number of confirmations required for spent inputs before relaying a transaction. Set to 0 to disable.',
		default: 0,
		min: 0,
		max: 1_000_000,
		step: 1,
		unit: 'blocks',
	},

	blockmaxsize: {
		tab: 'policy',
		kind: 'number',
		label: 'Maximum Block Template Serialized Size',
		bitcoinLabel: 'blockmaxsize',
		description:
			'Maximum serialized size (in bytes) of generated block templates. Default 4,000,000 leaves weight controlled by blockmaxweight.',
		default: 4_000_000,
		min: 1_000,
		max: 4_000_000,
		step: 1,
		unit: 'bytes',
	},

	blockmaxweight: {
		tab: 'policy',
		kind: 'number',
		label: 'Maximum Block Template Weight',
		bitcoinLabel: 'blockmaxweight',
		description:
			'Maximum BIP141 weight (in weight units) of generated block templates. Bitcoin Roots defaults to 1,200,000 WU (300 kB equivalent); consensus maximum is 4,000,000 WU.',
		default: 1_200_000,
		min: 8_000,
		max: 4_000_000,
		step: 1,
		unit: 'WU',
	},

	blockprioritysize: {
		tab: 'policy',
		kind: 'number',
		label: 'Block Template Priority Area Size',
		bitcoinLabel: 'blockprioritysize',
		description:
			'Maximum size (in bytes) reserved for high-priority / coin-age transactions in generated block templates.',
		default: 100_000,
		min: 0,
		max: 4_000_000,
		step: 1,
		unit: 'bytes',
	},

	maxmempool: {
		tab: 'optimization',
		kind: 'number',
		label: 'Maximum Mempool Size',
		bitcoinLabel: 'maxmempool',
		description:
			"Set the maximum size that your node will allocate (in RAM) for storing unconfirmed transactions before they are included in a block. By adjusting maxmempool, you can optimize your node's performance and balance memory usage based on your device's capabilities. A larger maxmempool allows your node to store more unconfirmed transactions, providing more accurate statistics on explorer apps like Mempool.",
		default: 300,
		unit: 'MB',
	},

	// Fee policy settings (rates shown as sat/vB; converted to BTC/kvB when writing bitcoin.conf)
	blockmintxfee: {
		tab: 'optimization',
		kind: 'number',
		label: 'Minimum Transaction Fee for Block Templates',
		bitcoinLabel: 'blockmintxfee',
		description:
			'Set the lowest fee rate for transactions to be included in block creation. Transactions below this threshold will not be considered when your node is constructing a block template (e.g., used by miners to filter transactions by fee rate).',
		// Default based on Bitcoin Core v30 help: ~0.001 sat/vB
		// backported to v29.x so packaged v29.2 has these same defaults (https://github.com/bitcoin/bitcoin/pull/33226)
		default: 0.001,
		min: 0,
		// Max derived from Core MoneyRange(MAX_MONEY): 21,000,000 BTC/kvB → 2_100_000_000_000 sat/vB
		// Core rejects out-of-range values (errors on startup) and does not clamp.
		max: 2_100_000_000_000,
		step: 0.001,
		unit: 'sat/vB',
	},

	minrelaytxfee: {
		tab: 'optimization',
		kind: 'number',
		label: 'Minimum Fee to Relay Transactions',
		bitcoinLabel: 'minrelaytxfee',
		description:
			'Sets the minimum fee rate your node will accept for relaying, mining, transaction creation, and mempool admission. Transactions below this threshold will be neither relayed nor accepted into your mempool.',
		subDescription: '⚠ It is recommended to also change incrementalrelayfee when changing this setting.',
		// Bitcoin Roots keeps the conservative default minimum relay fee of 1000 sat/kvB (1 sat/vB),
		// where Bitcoin Core v30 defaults to ~0.1 sat/vB.
		default: 1,
		min: 0,
		// Max derived from Core MoneyRange(MAX_MONEY): 21,000,000 BTC/kvB → 2_100_000_000_000 sat/vB
		// Core rejects out-of-range values (errors on startup) and does not clamp.
		max: 2_100_000_000_000,
		step: 0.001,
		unit: 'sat/vB',
	},

	incrementalrelayfee: {
		tab: 'optimization',
		kind: 'number',
		label: 'Additional Fee for Replacing Transactions',
		bitcoinLabel: 'incrementalrelayfee',
		description: 'Set the minimum fee rate increase necessary to replace an existing transaction in the mempool.',
		subDescription: '⚠ It is recommended to also change minrelaytxfee when changing this setting.',
		default: 0.1,
		min: 0,
		// Max derived from Core MoneyRange(MAX_MONEY): 21,000,000 BTC/kvB → 2_100_000_000_000 sat/vB
		// Core rejects out-of-range values (errors on startup) and does not clamp.
		max: 2_100_000_000_000,
		step: 0.001,
		unit: 'sat/vB',
	},

	mempoolexpiry: {
		tab: 'optimization',
		kind: 'number',
		label: 'Memory Expiration',
		bitcoinLabel: 'mempoolexpiry',
		description:
			"Set the time threshold (in hours) for unconfirmed transactions to remain in your node's mempool before being removed. By adjusting it, you can manage your node's memory usage and ensure outdated, unconfirmed transactions are discarded. A shorter expiry time helps keep your mempool up-to-date and reduces memory usage, while a longer expiry time allows transactions to remain in the pool for an extended period in case of network congestion or delayed confirmations.",
		step: 1,
		default: 336,
		unit: 'hours',
	},

	persistmempool: {
		tab: 'optimization',
		kind: 'toggle',
		label: 'Persist Mempool',
		bitcoinLabel: 'persistmempool',
		description:
			"Saves unconfirmed transactions in your node's mempool when it's shutting down and reloads them upon startup. Enabling this setting helps maintain a consistent mempool and prevents the loss of unconfirmed transactions during a restart. Disabling this setting will clear the mempool upon restart, which may reduce startup time but requires your node to rebuild its mempool from scratch.",
		default: true,
	},

	/* ===== Interfaces tab ===== */
	rest: {
		tab: 'rpc-rest',
		kind: 'toggle',
		label: 'Public REST API',
		bitcoinLabel: 'rest',
		description:
			'Enabling the public REST API can help you connect certain wallets and apps to your node. However, because the REST API access is unauthenticated, it can lead to unauthorized access, privacy degradation, and denial-of-service (DoS) attacks.',
		default: false,
	},

	rpcworkqueue: {
		tab: 'rpc-rest',
		kind: 'number',
		label: 'RPC Work Queue Size',
		bitcoinLabel: 'rpcworkqueue',
		description:
			'Set the maximum number of queued Remote Procedure Call (RPC) requests your node can handle (e.g., from connected wallets or other apps), helping you strike a balance between performance and resource usage. Higher values can improve processing speed at the cost of increased system resources.',
		step: 1,
		// Bitcoin Core's default is 64, but we use 128
		// No min or max in Core, but we should set a min here to avoid the user breaking the UI which relies on RPC calls to show data
		min: 1,
		default: 128,
		unit: 'requests',
	},

	ipc: {
		tab: 'rpc-rest',
		kind: 'toggle',
		label: 'IPC Mining Interface',
		bitcoinLabel: 'ipcbind',
		description:
			'Allow apps on your Umbrel to connect to Bitcoin Core over its IPC mining interface. This is required for Stratum V2 apps to request block templates and submit mined blocks from your node.',
		subDescription:
			'Requires Bitcoin Roots v30.3-roots.1 or newer. This uses the multiprocess mode and experimental IPC interface inherited from Bitcoin Core. Leave this disabled unless an app you use requires it.',
		default: false,
	},

	/* ===== Version tab ===== */
	// TODO: finess description and subDescription
	version: {
		tab: 'version',
		kind: 'select',
		label: 'Bitcoin Roots Version',
		bitcoinLabel: 'version',
		description:
			'Select whether to always run the latest version of Bitcoin Roots available in the Bitcoin Roots app, or stay on a specific version until you change it manually. Your Bitcoin Roots app will continue to receive updates from the Umbrel App Store even if you decide to stay on a specific version.',
		subDescription:
			'⚠ If you choose to stay on a specific version, please make sure your chosen version is up to date with the latest security fixes.',
		options: [
			{value: LATEST, label: 'Always use the latest version'},
			...AVAILABLE_BITCOIN_CORE_VERSIONS.map((version) => ({
				value: version,
				label: version,
			})),
		],
		default: LATEST,
	},

	/* ===== Network tab ===== */
	chain: {
		tab: 'network',
		kind: 'select',
		label: 'Bitcoin Network',
		bitcoinLabel: 'chain',
		description:
			'Choose which blockchain your node will connect to. If you change the chain, you may need to restart any connected apps to ensure they work correctly.',
		options: [
			{value: 'main', label: 'Mainnet'},
			{value: 'test', label: 'Testnet3'},
			{value: 'testnet4', label: 'Testnet4'},
			{value: 'signet', label: 'Signet'},
			{value: 'regtest', label: 'Regtest'},
		],
		default: 'main',
	},
} satisfies Record<string, VersionedOption>

// Gets the concrete Bitcoin Core version for a given selected version
export function resolveVersion(desired: SelectedVersion): BitcoinCoreVersion {
	// We always resolve 'latest' to the default version
	return desired === LATEST ? DEFAULT_BITCOIN_CORE_VERSION : desired
}

// Creates the version‑specific metadata for a given Bitcoin Core version:
export function settingsMetadataForVersion(version: BitcoinCoreVersion) {
	const metadata: Record<string, Option> = {}
	const versionIdx = AVAILABLE_BITCOIN_CORE_VERSIONS.indexOf(version)

	// Loop through each settingsMetadata entry and build the versioned metadata
	for (const [key, value] of Object.entries(settingsMetadata) as Array<[string, VersionedOption]>) {
		// Skip the setting entirely if it is not in the specified Bitcoin Core version
		if (value.introducedIn && versionIdx > AVAILABLE_BITCOIN_CORE_VERSIONS.indexOf(value.introducedIn)) continue
		if (value.removedIn && versionIdx <= AVAILABLE_BITCOIN_CORE_VERSIONS.indexOf(value.removedIn)) continue

		// Merge the versioned metadata with the version overrides
		const merged = {
			...value,
			...(value.versionOverrides?.[version] ?? {}),
		} as Record<string, unknown>

		// Strip the versioning keys
		delete merged['introducedIn']
		delete merged['removedIn']
		delete merged['versionOverrides']

		metadata[key] = merged as unknown as Option
	}

	return metadata
}

// Compute default form values for a given Bitcoin Core version.
export function DefaultValuesForVersion(version: BitcoinCoreVersion) {
	const metadata = settingsMetadataForVersion(version)
	const defaults = {} as Record<string, unknown>
	for (const key in metadata) defaults[key] = (metadata as Record<string, {default: unknown}>)[key].default
	return defaults
}
