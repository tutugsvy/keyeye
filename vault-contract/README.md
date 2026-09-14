# OWN VAULT contract

This is a Robinhood Chain (4663) vault for two supported assets:

- native ETH: `depositETH()` / `ownerWithdrawETH()`
- the configured USDG ERC-20: `depositUSDG()` / `ownerWithdrawToken()`

## Important custody warning

The deployer becomes `owner`. The owner has an explicit emergency rescue path:

- `ownerWithdrawETH(to, type(uint256).max)` withdraws all ETH held by the vault;
- `ownerWithdrawToken(token, to, type(uint256).max)` withdraws all tokens held by the vault.

That means the owner can withdraw user deposits and reward funding. This is **not a trustless vault**. The UI and product terms must disclose this clearly. Transfer ownership to a multisig before accepting deposits. There is no hidden backdoor; these owner functions are intentionally visible in the source and ABI.

## Build

```bash
forge build
```

## Deploy (manual, only after review)

Set the real USDG contract address and a deployer private key only in the local shell. Never put `PRIVATE_KEY` in Vite or frontend env files.

```bash
export ROBINHOOD_RPC='https://rpc.mainnet.chain.robinhood.com'
export USDG_ADDRESS='0x...'
export PRIVATE_KEY='0x...'
chmod 700 deploy.sh
./deploy.sh
```

The deployer is the owner. After deployment, set the rates from an owner wallet:

```text
setAnnualBps(address(0), ethRateBps)
setAnnualBps(USDG_ADDRESS, usdgRateBps)
```

`100` BPS = 1% annual rate. The contract only pays rewards if the vault is funded with enough ETH/USDG to cover them.

## Current scope

- one position per wallet per asset;
- optional lock duration from 0 to 365 days;
- `pendingReward()` and `claimReward()`;
- withdraw after unlock;
- owner rescue of all ETH/ERC-20 assets;
- no frontend transaction wiring yet until the deployed address and ABI are verified on Robinhood Chain.

Do not deploy this to mainnet with meaningful user funds before an independent security review. The owner rescue requirement creates a custodial trust assumption.
