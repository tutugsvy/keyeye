#!/usr/bin/env bash
set -euo pipefail

: "${ROBINHOOD_RPC:=https://rpc.mainnet.chain.robinhood.com}"
: "${USDG_ADDRESS:?Set the deployed USDG address first}"
: "${PRIVATE_KEY:?Set PRIVATE_KEY only in your secure local shell}"

forge script script/DeployOwnVaultV2.s.sol:DeployOwnVaultV2 \
  --rpc-url "$ROBINHOOD_RPC" \
  --broadcast \
  --private-key "$PRIVATE_KEY" \
  -vvvv
