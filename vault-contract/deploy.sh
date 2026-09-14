#!/usr/bin/env bash
set -euo pipefail

: "${ROBINHOOD_RPC:=https://rpc.mainnet.chain.robinhood.com}"
: "${USDG_ADDRESS:?Set the deployed USDG token address first}"
: "${PRIVATE_KEY:?Set PRIVATE_KEY only in your local secure shell}"

forge script script/DeployOwnVault.s.sol:DeployOwnVault \
  --rpc-url "$ROBINHOOD_RPC" \
  --broadcast \
  --private-key "$PRIVATE_KEY" \
  -vvvv
