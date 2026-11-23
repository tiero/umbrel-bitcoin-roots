#!/usr/bin/env bash
# Sourced by umbrelOS; do not change shell options in the caller.

# IP ADDRESSES
export APP_BITCOIN_ROOTS_NODE_IP="10.21.120.8"
export APP_BITCOIN_ROOTS_TOR_IP="10.21.120.9"
export APP_BITCOIN_ROOTS_TOR_PROXY_IP="${APP_BITCOIN_ROOTS_TOR_IP}"
export APP_BITCOIN_ROOTS_I2P_IP="10.21.120.10"
export APP_BITCOIN_ROOTS_I2P_DAEMON_IP="${APP_BITCOIN_ROOTS_I2P_IP}"

# DATA DIR (supports umbrelOS relocated storage via EXPORTS_APP_DATA_DIR)
_roots_data_root="${EXPORTS_APP_DATA_DIR:-${EXPORTS_APP_DIR:-}/data}"
export APP_BITCOIN_ROOTS_DATA_DIR="${_roots_data_root}/bitcoin"

# PORTS (non-conflicting with Bitcoin Core 8332/8333 and Bitcoin Knots 9332/9333
# so users can install side-by-side and migrate chain data before uninstalling)
export APP_BITCOIN_ROOTS_RPC_PORT="10332"
export APP_BITCOIN_ROOTS_P2P_PORT="10333"
export APP_BITCOIN_ROOTS_P2P_WHITEBIND_PORT="10335"
export APP_BITCOIN_ROOTS_TOR_PORT="8334"
export APP_BITCOIN_ROOTS_ZMQ_RAWBLOCK_PORT="28332"
export APP_BITCOIN_ROOTS_ZMQ_RAWTX_PORT="28333"
export APP_BITCOIN_ROOTS_ZMQ_HASHBLOCK_PORT="28334"
export APP_BITCOIN_ROOTS_ZMQ_SEQUENCE_PORT="28335"
export APP_BITCOIN_ROOTS_ZMQ_HASHTX_PORT="28336"

# CREDENTIALS
# Derive entropy from EXPORTS_APP_ID when sourced by umbrelOS so dependent apps
# (Core Lightning, Bassin, LND, Electrs, etc.) derive the exact same RPC password
# as Bitcoin Roots itself rather than using the caller's app_entropy_identifier.
export APP_BITCOIN_ROOTS_RPC_USER="umbrel"
if [[ -n "${EXPORTS_APP_ID:-}" ]]; then
	_roots_entropy_identifier="app-${EXPORTS_APP_ID}-seed"
else
	: "${app_entropy_identifier:?Umbrel exports context is required}"
	_roots_entropy_identifier="${app_entropy_identifier}"
fi
APP_BITCOIN_ROOTS_RPC_PASS=$(derive_entropy "${_roots_entropy_identifier}-rpc-password") || return 1
APP_BITCOIN_ROOTS_TOR_PASSWORD=$(derive_entropy "${_roots_entropy_identifier}-tor-password") || return 1
export APP_BITCOIN_ROOTS_RPC_PASS APP_BITCOIN_ROOTS_TOR_PASSWORD

# NETWORK AND IPC (read from saved settings.json if present)
export APP_BITCOIN_ROOTS_NETWORK="mainnet"
export APP_BITCOIN_ROOTS_IPC_ENABLED="false"
export APP_BITCOIN_ROOTS_IPC_SOCKET_RELATIVE_PATH="node.sock"

_roots_settings_file="${_roots_data_root}/app/settings.json"
if [[ -f "${_roots_settings_file}" ]] && command -v jq >/dev/null 2>&1; then
	_roots_chain=$(jq -r '.chain // empty' "${_roots_settings_file}" 2>/dev/null || true)
	case "${_roots_chain}" in
		"main")
			APP_BITCOIN_ROOTS_NETWORK="mainnet" ;;
		"test")
			APP_BITCOIN_ROOTS_NETWORK="testnet" ;;
		"testnet4")
			APP_BITCOIN_ROOTS_NETWORK="testnet4" ;;
		"signet")
			APP_BITCOIN_ROOTS_NETWORK="signet" ;;
		"regtest")
			APP_BITCOIN_ROOTS_NETWORK="regtest" ;;
		"")
			;;
		*)
			echo "Warning (${EXPORTS_APP_ID:-bitcoin-roots}): Invalid network '${_roots_chain}' in settings.json. Defaulting to 'mainnet'." ;;
	esac

	_roots_ipc=$(jq -r '.ipc // false' "${_roots_settings_file}" 2>/dev/null || true)
	if [[ "${_roots_ipc}" == "true" ]]; then
		APP_BITCOIN_ROOTS_IPC_ENABLED="true"
	fi
fi

case "${APP_BITCOIN_ROOTS_NETWORK}" in
	"testnet")
		APP_BITCOIN_ROOTS_IPC_SOCKET_RELATIVE_PATH="testnet3/node.sock" ;;
	"testnet4")
		APP_BITCOIN_ROOTS_IPC_SOCKET_RELATIVE_PATH="testnet4/node.sock" ;;
	"signet")
		APP_BITCOIN_ROOTS_IPC_SOCKET_RELATIVE_PATH="signet/node.sock" ;;
	"regtest")
		APP_BITCOIN_ROOTS_IPC_SOCKET_RELATIVE_PATH="regtest/node.sock" ;;
esac
export APP_BITCOIN_ROOTS_NETWORK APP_BITCOIN_ROOTS_IPC_ENABLED APP_BITCOIN_ROOTS_IPC_SOCKET_RELATIVE_PATH

# Electrs-compatible network parameter
APP_BITCOIN_ROOTS_NETWORK_ELECTRS="${APP_BITCOIN_ROOTS_NETWORK}"
if [[ "${APP_BITCOIN_ROOTS_NETWORK_ELECTRS}" == "mainnet" ]]; then
	APP_BITCOIN_ROOTS_NETWORK_ELECTRS="bitcoin"
fi
export APP_BITCOIN_ROOTS_NETWORK_ELECTRS

# HIDDEN SERVICES (stored under Bitcoin Roots' persistent data/tor directory)
_roots_rpc_hs_file="${_roots_data_root}/tor/rpc/hostname"
_roots_p2p_hs_file="${_roots_data_root}/tor/p2p/hostname"
APP_BITCOIN_ROOTS_RPC_HIDDEN_SERVICE=$(cat "${_roots_rpc_hs_file}" 2>/dev/null || echo "notyetset.onion")
APP_BITCOIN_ROOTS_P2P_HIDDEN_SERVICE=$(cat "${_roots_p2p_hs_file}" 2>/dev/null || echo "notyetset.onion")
export APP_BITCOIN_ROOTS_RPC_HIDDEN_SERVICE APP_BITCOIN_ROOTS_P2P_HIDDEN_SERVICE

# Canonical APP_BITCOIN_* exports for apps depending on `bitcoin`
for _roots_var in \
	NODE_IP \
	TOR_PROXY_IP \
	I2P_DAEMON_IP \
	DATA_DIR \
	RPC_PORT \
	P2P_PORT \
	P2P_WHITEBIND_PORT \
	TOR_PORT \
	ZMQ_RAWBLOCK_PORT \
	ZMQ_RAWTX_PORT \
	ZMQ_HASHBLOCK_PORT \
	ZMQ_SEQUENCE_PORT \
	ZMQ_HASHTX_PORT \
	NETWORK \
	NETWORK_ELECTRS \
	IPC_ENABLED \
	IPC_SOCKET_RELATIVE_PATH \
	RPC_USER \
	RPC_PASS \
	RPC_HIDDEN_SERVICE \
	P2P_HIDDEN_SERVICE
do
	_roots_bitcoin_var="APP_BITCOIN_${_roots_var}"
	_roots_src_var="APP_BITCOIN_ROOTS_${_roots_var}"
	if [[ -n "${!_roots_src_var-}" ]]; then
		export "${_roots_bitcoin_var}=${!_roots_bitcoin_var:=${!_roots_src_var}}"
	fi
done

unset _roots_data_root _roots_entropy_identifier _roots_settings_file _roots_chain _roots_ipc \
	_roots_rpc_hs_file _roots_p2p_hs_file _roots_var _roots_bitcoin_var _roots_src_var
