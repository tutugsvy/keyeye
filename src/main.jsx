import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const MODES = [
  { id: 'flex', name: 'Flexible', detail: 'Withdraw anytime', apy: { USDG: 2.7, ETH: 1.2 } },
  { id: '7d', name: '7 days', detail: 'Short lock', apy: { USDG: 3, ETH: 1.4 } },
  { id: '90d', name: '90 days', detail: 'Best rate', apy: { USDG: 6.2, ETH: 1.75 } },
]

const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || '0x67b953ac1d98f9dfe17ab1854bd54b180f95ae07'
const PONS_CHART_URL = import.meta.env.VITE_PONS_CHART_URL || 'https://vault.ownvault.online/pons-chart'
const BUY_URL = import.meta.env.VITE_BUY_URL || 'https://dexscreener.com/robinhood/0xPairAddress'
const USDG_ADDRESS = import.meta.env.VITE_USDG_ADDRESS || '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS || '0xe70BdAd94756059B7A012b72fFAA8344Be40C057'
const ROBINHOOD_RPC = import.meta.env.VITE_ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com'
const ROBINHOOD_CHAIN_ID = '0x1237'
const ROBINHOOD_CHAIN = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [ROBINHOOD_RPC],
  blockExplorerUrls: ['https://explorer.mainnet.chain.robinhood.com'],
}
const TOKEN_SUPPLY = 1_000_000_000
const ERC20_BALANCE_OF = '0x70a08231'
const ERC20_DECIMALS = '0x313ce567'
const ERC20_APPROVE = '0x095ea7b3'
const ERC20_ALLOWANCE = '0xdd62ed3e'
const VAULT_DEPOSIT_USDG = '0xe68c848b'
const VAULT_DEPOSIT_ETH = '0x7ef275d0'
const VAULT_PENDING_REWARD = '0x12f7086c'
const VAULT_CLAIM_REWARD = '0xae169a50'
const VAULT_WITHDRAW = '0x2e1a7d4d'
const VAULT_GET_POSITION_IDS = '0x28fe7031'
const VAULT_POSITIONS = '0x99fbab88'
const VAULT_DEPOSITED_TOPIC = '0x2526c3a85c66a62a72e729d806365c0b58d83d9d9ee05c16f728b341e22f78a6'
const VAULT_WITHDRAWN_TOPIC = '0x797e31b6b51d19b40bab085870e4169de8da20093887992214e3ca57288fc209'

const word = (value) => String(value).replace(/^0x/, '').padStart(64, '0')
const encodeAddress = (address) => word(address)
const encodeUint = (value) => BigInt(value).toString(16).padStart(64, '0')
const encodeCall = (selector, args = []) => selector + args.join('')
const decodeLogWord = (data, index) => BigInt(`0x${String(data).replace(/^0x/, '').slice(index * 64, (index + 1) * 64) || '0'}`)
const decodePositionIds = (raw) => {
  const words = String(raw).replace(/^0x/, '').match(/.{64}/g) || []
  const length = Number(BigInt(`0x${words[1] || '0'}`))
  return words.slice(2, 2 + length).map((wordValue) => Number(BigInt(`0x${wordValue}`)))
}
const waitForReceipt = async (hash) => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] })
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error('Transaction reverted')
      return receipt
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Transaction confirmation timed out')
}

const parseUnits = (input, decimals) => {
  const text = String(input ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(text) || Number(text) <= 0) throw new Error('Enter a valid positive amount')
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > decimals) throw new Error(`Maximum ${decimals} decimal places`)
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

const formatTokenBalance = (raw, decimals = 18) => {
  if (raw == null) return '—'
  const value = Number(raw) / (10 ** decimals)
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: 18 })
}

async function ensureRobinhoodNetwork() {
  if (!window.ethereum) throw new Error('Wallet provider unavailable')
  const current = await window.ethereum.request({ method: 'eth_chainId' })
  if (String(current).toLowerCase() === ROBINHOOD_CHAIN_ID) return
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ROBINHOOD_CHAIN_ID }] })
  } catch (error) {
    if (error?.code !== 4902) throw new Error('Switch wallet to Robinhood Chain before continuing')
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [ROBINHOOD_CHAIN] })
  }
  const verified = await window.ethereum.request({ method: 'eth_chainId' })
  if (String(verified).toLowerCase() !== ROBINHOOD_CHAIN_ID) throw new Error('Wallet is not connected to Robinhood Chain')
}

async function readWalletBalances(requestAccounts = true) {
  if (!window.ethereum) throw new Error('Wallet provider unavailable')
  await ensureRobinhoodNetwork()
  const accounts = await window.ethereum.request({ method: requestAccounts ? 'eth_requestAccounts' : 'eth_accounts' })
  const address = accounts?.[0]
  if (!address) throw new Error('No wallet account selected')
  const ethHex = await window.ethereum.request({ method: 'eth_getBalance', params: [address, 'latest'] })
  let usdg = null
  let usdgDecimals = 18
  if (USDG_ADDRESS) {
    const data = ERC20_BALANCE_OF + address.slice(2).padStart(64, '0')
    const result = await window.ethereum.request({ method: 'eth_call', params: [{ to: USDG_ADDRESS, data }, 'latest'] })
    try {
      const decimalResult = await window.ethereum.request({ method: 'eth_call', params: [{ to: USDG_ADDRESS, data: ERC20_DECIMALS }, 'latest'] })
      usdgDecimals = Number(BigInt(decimalResult))
    } catch {}
    usdg = formatTokenBalance(BigInt(result), usdgDecimals)
  }
  return { address, eth: formatTokenBalance(BigInt(ethHex), 18), usdg, usdgDecimals }
}

function PriceChart({ points, backendCandles, chartState }) {
  const rawCandles = Array.isArray(backendCandles) && backendCandles.length
    ? backendCandles.map((candle) => ({
      time: Number(candle.t),
      open: Number(candle.o ?? candle.open),
      high: Number(candle.h ?? candle.high),
      low: Number(candle.l ?? candle.low),
      close: Number(candle.c ?? candle.close),
      volume: Number(candle.v ?? candle.volume ?? 0),
    }))
    : points.map((point) => ({
      time: Number(point.t || point.timestamp || 0),
      open: Number(point.price),
      high: Number(point.price),
      low: Number(point.price),
      close: Number(point.price),
      volume: Number(point.volumeQuote ?? point.volume ?? 0),
    }))
  const candles = rawCandles
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0))
    .slice(-40)
    .map((candle, index, list) => ({
      ...candle,
      // When only tick prices are available, use the adjacent tick as the close
      // so every real tick remains visible instead of collapsing to a flat doji.
      open: backendCandles?.length ? candle.open : index ? list[index - 1].close : candle.open,
      close: backendCandles?.length ? candle.close : candle.close,
    }))

  if (chartState !== 'live' || !candles.length) {
    return <span className="candle-empty">{chartState === 'loading' ? 'LOADING PONS CHART' : chartState === 'not_configured' ? 'NO TOKEN ADDRESS CONFIGURED' : 'NO PONS PRICE DATA'}</span>
  }

  const prices = candles.flatMap((candle) => [candle.high, candle.low, candle.open, candle.close])
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const spread = Math.max(max - min, max * 0.002, Number.EPSILON)
  const pad = spread * 0.16
  const low = min - pad
  const high = max + pad
  const y = (price) => 16 + ((high - price) / (high - low)) * 132
  const latest = candles[candles.length - 1].close
  const first = candles[0].open
  const change = first ? ((latest - first) / first) * 100 : 0
  const formatPrice = (value) => value.toExponential(3)
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 0)
  const candleWidth = Math.max(6, Math.min(20, (578 / Math.max(candles.length, 1)) * 0.62))
  const x = (index) => 31 + (index / Math.max(candles.length - 1, 1)) * 578

  return <>
    <svg className="price-chart" viewBox="0 0 640 204" preserveAspectRatio="none" role="img" aria-label="Live Pons candlestick chart">
      {[18, 50, 82, 114, 146].map((lineY) => <line key={lineY} x1="18" x2="622" y1={lineY} y2={lineY} className="chart-grid-line"/>)}
      {candles.map((candle, index) => {
        const cx = x(index)
        const rising = candle.close >= candle.open
        const bodyTop = Math.min(y(candle.open), y(candle.close))
        const bodyHeight = Math.max(2, Math.abs(y(candle.open) - y(candle.close)))
        const volumeHeight = maxVolume > 0 ? Math.max(3, (candle.volume / maxVolume) * 32) : 0
        return <g key={`${candle.time}-${index}`} className={`candle ${rising ? 'up' : 'down'}`}>
          <line x1={cx} x2={cx} y1={y(candle.high)} y2={y(candle.low)} className="candle-wick"/>
          <rect x={cx - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx="1" className="candle-body"/>
          {volumeHeight > 0 && <rect x={cx - candleWidth / 2} y={184 - volumeHeight} width={candleWidth} height={volumeHeight} className="volume-bar"/>}
        </g>
      })}
      <line x1="18" x2="622" y1="184" y2="184" className="volume-baseline"/>
      <line x1={x(candles.length - 1)} x2={x(candles.length - 1)} y1="20" y2="184" className="chart-crosshair"/>
    </svg>
    <div className="chart-scale"><span>{formatPrice(high)}</span><span>{formatPrice(latest)} <b className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</b></span><span>{formatPrice(low)}</span></div>
  </>
}

function App() {
  const [connected, setConnected] = useState(false)
  const [asset, setAsset] = useState('USDG')
  const [mode, setMode] = useState('90d')
  const [amount, setAmount] = useState('')
  const [chart, setChart] = useState(null)
  const [chartState, setChartState] = useState(TOKEN_ADDRESS ? 'loading' : 'not_configured')
  const [toast, setToast] = useState('')
  const [now, setNow] = useState(new Date())
  const [walletBalances, setWalletBalances] = useState(null)
  const [txPending, setTxPending] = useState(false)
  const [position, setPosition] = useState(null)
  const [positionLoading, setPositionLoading] = useState(false)
  const [contractRates, setContractRates] = useState({ USDG: null, ETH: null })
  const [vaultBalances, setVaultBalances] = useState({ USDG: null, ETH: null })
  const [movement, setMovement] = useState([])
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const positionRequest = useRef(0)

  useEffect(() => {
    if (!window.ethereum?.on) return undefined
    const refresh = () => {
      setConnected(false)
      setWalletBalances(null)
    }
    window.ethereum.on('chainChanged', refresh)
    window.ethereum.on('accountsChanged', refresh)
    return () => {
      window.ethereum.removeListener?.('chainChanged', refresh)
      window.ethereum.removeListener?.('accountsChanged', refresh)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const restoreWallet = async () => {
      if (!window.ethereum) return
      try {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' })
        if (String(chainId).toLowerCase() !== ROBINHOOD_CHAIN_ID) return
        const accounts = await window.ethereum.request({ method: 'eth_accounts' })
        if (!accounts?.[0] || cancelled) return
        const balances = await readWalletBalances(false)
        if (!cancelled) {
          setWalletBalances(balances)
          setConnected(true)
          await refreshPosition?.(balances.address)
        }
      } catch {}
    }
    restoreWallet()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!TOKEN_ADDRESS) return undefined
    let cancelled = false
    const loadChart = () => {
      const url = new URL(PONS_CHART_URL)
      url.searchParams.set('address', TOKEN_ADDRESS)
      url.searchParams.set('range', '5m')
      fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Pons HTTP ${response.status}`)
        return response.json()
      }).then((data) => {
        if (!cancelled) { setChart(data); setChartState(Array.isArray(data?.points) && data.points.length ? 'live' : 'unavailable') }
      }).catch(() => { if (!cancelled) setChartState('unavailable') })
    }
    loadChart()
    const timer = setInterval(loadChart, 15000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!connected || !window.ethereum) return undefined
    const readRates = async () => {
      try {
        const [usdgRaw, ethRaw] = await Promise.all([USDG_ADDRESS, '0x0000000000000000000000000000000000000000'].map((token) => window.ethereum.request({ method: 'eth_call', params: [{ to: VAULT_ADDRESS, data: encodeCall(VAULT_ANNUAL_BPS, [encodeAddress(token)]) }, 'latest'] })))
        setContractRates({ USDG: Number(BigInt(usdgRaw)) / 100, ETH: Number(BigInt(ethRaw)) / 100 })
      } catch { setContractRates({ USDG: null, ETH: null }) }
    }
    readRates()
  }, [connected])

  const selected = MODES.find((item) => item.id === mode)
  const value = Number(amount) || 0
  const notify = (message) => { setToast(message); setTimeout(() => setToast(''), 2400) }
  const displayApy = MODES.find((item) => item.id === mode)?.apy[asset] ?? 0
  const displayYearly = value * displayApy / 100

  const connectWallet = async () => {
    try {
      const balances = await readWalletBalances()
      setWalletBalances(balances)
      setConnected(true)
      notify('Wallet connected · balances loaded')
    } catch (error) {
      notify(error.message || 'Wallet connection failed')
    }
  }
  const copyTokenAddress = async () => {
    if (!TOKEN_ADDRESS) return notify('Contract address is not configured')
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(TOKEN_ADDRESS)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = TOKEN_ADDRESS
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        if (!copied) throw new Error('Clipboard copy failed')
      }
      notify('Contract address copied')
    } catch {
      notify('Copy blocked — select the CA manually')
    }
  }
  const refreshPosition = async (address = walletBalances?.address) => {
    if (!address || !window.ethereum) return
    const requestId = ++positionRequest.current
    const assetAddress = asset === 'USDG' ? USDG_ADDRESS : '0x0000000000000000000000000000000000000000'
    try {
      const idsData = encodeCall(VAULT_GET_POSITION_IDS, [encodeAddress(address)])
      const idsRaw = await window.ethereum.request({ method: 'eth_call', params: [{ to: VAULT_ADDRESS, data: idsData }, 'latest'] })
      const ids = decodePositionIds(idsRaw)
      const candidates = []
      for (const positionId of ids.slice(-20).reverse()) {
        const positionData = encodeCall(VAULT_POSITIONS, [encodeUint(positionId)])
        const raw = await window.ethereum.request({ method: 'eth_call', params: [{ to: VAULT_ADDRESS, data: positionData }, 'latest'] })
        const words = String(raw).replace(/^0x/, '').match(/.{64}/g) || []
        const positionAsset = `0x${(words[1] || '').slice(-40)}`
        const principal = BigInt(`0x${words[2] || '0'}`)
        const annualBpsSnapshot = Number(BigInt(`0x${words[3] || '0'}`))
        const depositedAt = Number(BigInt(`0x${words[4] || '0'}`))
        const lastClaimAt = Number(BigInt(`0x${words[5] || '0'}`))
        const unlockAt = Number(BigInt(`0x${words[6] || '0'}`))
        const active = BigInt(`0x${words[7] || '0'}`) === 1n
        const isAsset = positionAsset.toLowerCase().endsWith(assetAddress.slice(-40).toLowerCase())
        if (active && principal > 0n && isAsset) candidates.push({ positionId, principal, annualBpsSnapshot, depositedAt, lastClaimAt, unlockAt })
      }
      const selectedPosition = candidates[0]
      if (!selectedPosition) { if (requestId === positionRequest.current) setPosition(null); return }
      const pendingData = encodeCall(VAULT_PENDING_REWARD, [encodeUint(selectedPosition.positionId)])
      const pending = await window.ethereum.request({ method: 'eth_call', params: [{ to: VAULT_ADDRESS, data: pendingData }, 'latest'] })
      if (requestId !== positionRequest.current) return
      setPosition({ ...selectedPosition, pending: formatTokenBalance(BigInt(pending), asset === 'USDG' ? (walletBalances?.usdgDecimals ?? 6) : 18), principal: formatTokenBalance(selectedPosition.principal, asset === 'USDG' ? (walletBalances?.usdgDecimals ?? 6) : 18), hasPosition: true, positionCount: candidates.length })
    } catch { if (requestId === positionRequest.current) setPosition(null) }
  }

  useEffect(() => {
    if (!connected || !walletBalances?.address) return undefined
    refreshPosition(walletBalances.address)
    const timer = setInterval(() => refreshPosition(walletBalances.address), 1000)
    return () => clearInterval(timer)
  }, [connected, walletBalances?.address, asset])

  useEffect(() => {
    if (!connected || !window.ethereum) return undefined
    const readVaultData = async () => {
      try {
        const [usdgRaw, ethRaw, latestBlock] = await Promise.all([
          window.ethereum.request({ method: 'eth_call', params: [{ to: USDG_ADDRESS, data: encodeCall(ERC20_BALANCE_OF, [encodeAddress(VAULT_ADDRESS)]) }, 'latest'] }),
          window.ethereum.request({ method: 'eth_getBalance', params: [VAULT_ADDRESS, 'latest'] }),
          window.ethereum.request({ method: 'eth_blockNumber', params: [] }),
        ])
        setVaultBalances({ USDG: formatTokenBalance(BigInt(usdgRaw), walletBalances?.usdgDecimals ?? 6), ETH: formatTokenBalance(BigInt(ethRaw), 18) })
        const fromBlock = `0x${Math.max(0, Number(BigInt(latestBlock)) - 100000).toString(16)}`
        const [deposits, withdrawals] = await Promise.all([VAULT_DEPOSITED_TOPIC, VAULT_WITHDRAWN_TOPIC].map((topic) => window.ethereum.request({ method: 'eth_getLogs', params: [{ address: VAULT_ADDRESS, topics: [topic], fromBlock, toBlock: 'latest' }] })))
        const rows = [...(deposits || []).filter((log) => !walletBalances?.address || log.topics?.[2]?.toLowerCase() === walletBalances.address.toLowerCase()).map((log) => ({ type: 'DEPOSIT', hash: log.transactionHash, block: Number(BigInt(log.blockNumber)), time: log.blockTimestamp, asset: log.topics?.[3]?.toLowerCase() === USDG_ADDRESS.toLowerCase() ? 'USDG' : 'ETH', positionId: Number(BigInt(log.topics?.[1] || '0x0')), amount: decodeLogWord(log.data, 0) })), ...(withdrawals || []).filter((log) => !walletBalances?.address || log.topics?.[2]?.toLowerCase() === walletBalances.address.toLowerCase()).map((log) => ({ type: 'WITHDRAW', hash: log.transactionHash, block: Number(BigInt(log.blockNumber)), time: log.blockTimestamp, asset: log.topics?.[3]?.toLowerCase() === USDG_ADDRESS.toLowerCase() ? 'USDG' : 'ETH', positionId: Number(BigInt(log.topics?.[1] || '0x0')), amount: decodeLogWord(log.data, 0) }))].sort((a, b) => b.block - a.block).slice(0, 8)
        setMovement(rows)
      } catch { setMovement([]) }
    }
    readVaultData()
    const timer = setInterval(readVaultData, 15000)
    return () => clearInterval(timer)
  }, [connected, walletBalances?.usdgDecimals])
  const formatCountdown = (unlockAt) => {
    const remaining = Math.max(0, unlockAt - Math.floor(Date.now() / 1000))
    if (!remaining) return 'UNLOCKED'
    const days = Math.floor(remaining / 86400)
    const hours = Math.floor((remaining % 86400) / 3600)
    const minutes = Math.floor((remaining % 3600) / 60)
    const seconds = remaining % 60
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  }

  const deposit = async () => {
    if (!connected || !walletBalances?.address) return notify('Connect wallet before depositing')
    if (!VAULT_ADDRESS) return notify('Vault is not configured')
    setTxPending(true)
    try {
      await ensureRobinhoodNetwork()
      const lockDuration = mode === '90d' ? 90 * 86400 : mode === '7d' ? 7 * 86400 : 0
      const token = asset === 'USDG' ? USDG_ADDRESS : '0x0000000000000000000000000000000000000000'
      if (asset === 'USDG') {
        const rawAmount = parseUnits(amount, walletBalances.usdgDecimals ?? 18)
        const allowanceData = encodeCall(ERC20_ALLOWANCE, [encodeAddress(walletBalances.address), encodeAddress(VAULT_ADDRESS)])
        const allowanceRaw = await window.ethereum.request({ method: 'eth_call', params: [{ to: USDG_ADDRESS, data: allowanceData }, 'latest'] })
        const allowance = BigInt(allowanceRaw)
        if (allowance < rawAmount) {
          const approvalData = encodeCall(ERC20_APPROVE, [encodeAddress(VAULT_ADDRESS), encodeUint(rawAmount)])
          const approvalHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: walletBalances.address, to: USDG_ADDRESS, data: approvalData }] })
          notify('USDG approval required · waiting for confirmation')
          await waitForReceipt(approvalHash)
        }
        const depositData = encodeCall(VAULT_DEPOSIT_USDG, [encodeUint(rawAmount), encodeUint(lockDuration)])
        const depositHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: walletBalances.address, to: VAULT_ADDRESS, data: depositData }] })
        notify('USDG deposit submitted · waiting for confirmation')
        await waitForReceipt(depositHash)
      } else {
        const rawAmount = parseUnits(amount, 18)
        const depositData = encodeCall(VAULT_DEPOSIT_ETH, [encodeUint(lockDuration)])
        const depositHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: walletBalances.address, to: VAULT_ADDRESS, data: depositData, value: `0x${rawAmount.toString(16)}` }] })
        notify('ETH deposit submitted · waiting for confirmation')
        await waitForReceipt(depositHash)
      }
      const balances = await readWalletBalances()
      setWalletBalances(balances)
      await refreshPosition(balances.address)
      notify(`${asset} deposit confirmed`)
    } catch (error) {
      notify(error?.message || `${asset} deposit failed`)
    } finally { setTxPending(false) }
  }

  const claimReward = async () => {
    if (!connected || !walletBalances?.address) return notify('Connect wallet before claiming')
    setTxPending(true)
    try {
      await ensureRobinhoodNetwork()
      const data = encodeCall(VAULT_CLAIM_REWARD, [encodeUint(position?.positionId ?? 0)])
      const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: walletBalances.address, to: VAULT_ADDRESS, data }] })
      notify('Claim submitted · waiting for confirmation')
      await waitForReceipt(hash)
      const balances = await readWalletBalances(); setWalletBalances(balances); await refreshPosition(balances.address)
      notify(`${asset} reward claimed`)
    } catch (error) { notify(error?.message || 'Claim failed') } finally { setTxPending(false) }
  }

  const withdraw = async () => {
    if (!connected || !walletBalances?.address) return notify('Connect wallet before withdrawing')
    setTxPending(true)
    try {
      await ensureRobinhoodNetwork()
      const data = encodeCall(VAULT_WITHDRAW, [encodeUint(position?.positionId ?? 0)])
      const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: walletBalances.address, to: VAULT_ADDRESS, data }] })
      notify('Withdraw submitted · waiting for confirmation')
      await waitForReceipt(hash)
      const balances = await readWalletBalances(); setWalletBalances(balances); setPosition(null)
      notify(`${asset} withdrawal confirmed`)
    } catch (error) { notify(error?.message || 'Withdraw failed') } finally { setTxPending(false) }
  }

  const points = Array.isArray(chart?.points) ? chart.points : []
  const livePrice = points.length && Number.isFinite(Number(points[points.length - 1].price)) && Number.isFinite(Number(chart?.quoteUsd))
    ? Number(points[points.length - 1].price) * Number(chart.quoteUsd)
    : null
  const marketCap = livePrice == null ? null : livePrice * TOKEN_SUPPLY
  const formatUsd = (value) => value == null ? '—' : value >= 1000 ? `$${(value / 1000).toFixed(2)}K` : value >= 1 ? `$${value.toFixed(2)}` : `$${value.toExponential(3).replace('e-', 'e−')}`
  const shortAddress = TOKEN_ADDRESS ? `${TOKEN_ADDRESS.slice(0, 8)}…${TOKEN_ADDRESS.slice(-6)}` : 'NOT CONFIGURED'

  return <div className="app">
    <header>
      <div className="wordmark"><img className="brand-logo" src="/own-vault-logo.jpg" alt="OWN VAULT logo"/><b>OWN VAULT</b><small>/ PRIVATE YIELD SYSTEM</small></div>
      <div className="network"><i/> ROBINHOOD CHAIN <span>4663</span></div>
      <button className="dashboard-toggle" onClick={() => setDashboardOpen((open) => !open)}>{dashboardOpen ? 'Close dashboard' : 'Dashboard'} <em>↗</em></button><button className="connect" onClick={connectWallet}>{connected ? `${walletBalances?.address?.slice(0, 6)}…${walletBalances?.address?.slice(-4)}` : 'Connect wallet'} <em>↗</em></button>
    </header>

    <nav className="steps"><a href="#dashboard" onClick={() => setDashboardOpen(true)} className={connected ? 'done' : ''}><i>01</i> Dashboard</a><b/><a href="#position" className={connected ? 'active' : ''}><i>02</i> Deposit</a><b/><a href="#lock"><i>03</i> Lock</a><b/><a href="#rewards"><i>04</i> Rewards</a></nav>

    <main>
      {dashboardOpen && <section id="dashboard" className="vault-dashboard">
        <div className="dashboard-head"><div><span className="dashboard-eyebrow">01 / POSITION CONTROL</span><h2>Your position.</h2><p>Capital, rewards, and unlock timing in one view.</p></div><div className="dashboard-head-actions"><span className="chain-pill"><i/> {connected ? 'ON-CHAIN' : 'WALLET REQUIRED'}</span><button className="dashboard-close" onClick={() => setDashboardOpen(false)}>Close ×</button></div></div>
        <div className="dashboard-overview">
          <div className="overview-card overview-primary"><span className="overview-label">TOTAL STAKED</span><strong>{position?.hasPosition ? position.principal : '—'}</strong><b>{position?.hasPosition ? asset : 'Connect wallet'}</b><small>Principal currently held in this position</small></div>
          <div className="overview-card"><span className="overview-label">LIVE REWARD</span><strong>{position?.pending ?? '—'}</strong><b>{asset}</b><small>Pending reward from the vault</small></div>
          <div className="overview-card"><span className="overview-label">POSITION STATUS</span><strong className="status-value">{position?.hasPosition ? (position.unlockAt && position.unlockAt <= Math.floor(Date.now() / 1000) ? 'READY' : 'LOCKED') : 'EMPTY'}</strong><small>{position?.hasPosition ? 'Withdraw follows the unlock schedule' : 'Deposit an asset to create a position'}</small></div>
        </div>
        <div className="position-detail-card">
          <div className="position-detail-top"><div className="asset-identity"><img src={asset === 'USDG' ? '/assets/usdg-logo-crop.png' : '/assets/eth-logo-crop.png'} alt={`${asset} logo`}/><div><span>ACTIVE POSITION</span><strong>{asset} vault</strong></div></div><span className="position-state">{position?.hasPosition ? '● ACTIVE' : '○ NO POSITION'}</span></div>
          <div className="position-metrics"><div><span>DEPOSITED</span><b>{position?.depositedAt ? new Date(position.depositedAt * 1000).toLocaleDateString() : '—'}</b><small>{position?.depositedAt ? new Date(position.depositedAt * 1000).toLocaleTimeString() : 'Waiting for wallet'}</small></div><div><span>UNLOCKS</span><b>{position?.unlockAt ? new Date(position.unlockAt * 1000).toLocaleDateString() : '—'}</b><small>{position?.unlockAt ? new Date(position.unlockAt * 1000).toLocaleTimeString() : 'No active lock'}</small></div><div><span>COUNTDOWN</span><b className="countdown-value">{position?.hasPosition ? formatCountdown(position.unlockAt) : '—'}</b><small>{position?.hasPosition ? 'Contract timestamp' : '—'}</small></div></div>
          <div className="position-progress"><div className="progress-label"><span>POSITION LIFECYCLE</span><b>{position?.hasPosition ? (position.unlockAt <= Math.floor(Date.now() / 1000) ? 'WITHDRAW AVAILABLE' : 'EARNING') : 'NOT STARTED'}</b></div><div className="progress-track"><i style={{width: position?.hasPosition ? (position.unlockAt <= Math.floor(Date.now() / 1000) ? '100%' : '18%') : '0%'}}/></div></div>
          <div className="position-actions"><button className="secondary" disabled={!position?.hasPosition || txPending} onClick={claimReward}>Claim {asset} reward</button><button className="action" disabled={!position?.hasPosition || txPending || (position?.unlockAt > Math.floor(Date.now() / 1000))} onClick={withdraw}>Withdraw position ↗</button></div>
        </div>
        <div className="dashboard-lower-grid"><div className="allocation dashboard-subcard"><div className="subcard-head"><div><span>VAULT RESERVES</span><h3>Allocation.</h3></div><i>LIVE</i></div><div className="reserve-row"><span><img src="/assets/usdg-logo-crop.png" alt="USDG"/> USDG</span><b>{vaultBalances.USDG ?? '—'}</b></div><div className="reserve-row"><span><img src="/assets/eth-logo-crop.png" alt="ETH"/> ETH</span><b>{vaultBalances.ETH ?? '—'}</b></div></div><div className="activity dashboard-subcard"><div className="subcard-head"><div><span>ON-CHAIN EVENTS</span><h3>Recent movement.</h3></div><i>LIVE</i></div><div className="activity-list">{movement.length ? movement.slice(0, 4).map((row) => <div className="movement-row" key={`${row.hash}-${row.type}`}><span><b>{row.type}</b><small>{row.asset} · block {row.block}</small></span><strong>{formatTokenBalance(row.amount, row.asset === 'USDG' ? (walletBalances?.usdgDecimals ?? 6) : 18)} {row.asset}</strong></div>) : <div className="empty-live">NO RECENT VAULT MOVEMENT</div>}</div></div></div>
      </section>}

      <section className="intro">
        <div className="copy"><p className="kicker">OWN / CAPITAL INSTRUMENT 01</p><h1>A quieter way<br/>to <em>earn.</em></h1><p className="lead">Deposit digital assets into a disciplined vault. Keep a clear view of what is liquid, what is locked, and what your capital is earning.</p><div className="mini-status"><i/> {connected ? 'WALLET CONNECTED' : 'CONNECT A WALLET TO BEGIN'} <span>·</span> LIVE DATA ONLY</div></div>
        <div className="chamber pons-chamber">
          <div className="chamber-top"><span>PONS LIVE CHART / 5M</span><span>{now.toLocaleTimeString('en-GB')}</span></div>
          <div className="pons-status"><i/> {chartState === 'live' ? 'LIVE · PONS DATA' : chartState === 'loading' ? 'CONNECTING TO PONS' : chartState === 'not_configured' ? 'CHART NOT CONFIGURED' : 'PONS DATA UNAVAILABLE'}</div>
          <div className="chart-stats"><div><small>MCAP</small><strong>{formatUsd(marketCap)}</strong></div><div><small>PRICE</small><strong>{formatUsd(livePrice)}</strong></div></div>
          <div className="candle-visual"><PriceChart points={points} backendCandles={chart?.candles} chartState={chartState}/></div>
          <div className="ca-row"><span>CA <b>{shortAddress}</b></span><button disabled={!TOKEN_ADDRESS} onClick={copyTokenAddress}>COPY CA</button>{BUY_URL && <a href={BUY_URL} target="_blank" rel="noreferrer">BUY NOW ↗</a>}</div>
          <div className="chamber-bottom"><span>LIVE PRICE / VOLUME</span><span><b>{chartState === 'live' ? 'CONNECTED' : 'UNAVAILABLE'}</b></span></div>
        </div>
      </section>

      <section id="position" className="capital-grid">
        <div className="fund-panel"><div className="section-head"><div><small>01 / FUND THE VAULT</small><h2>Feed your position.</h2></div><span className="status">{connected ? 'READY' : 'LOCKED'}</span></div><p className="section-copy">Choose an asset and place capital into your own position. Rates are calculated from the selected lock duration.</p><label>ASSET</label><div className="asset-pills">{['USDG', 'ETH'].map((item) => <button className={asset === item ? 'selected' : ''} onClick={() => setAsset(item)} key={item}><img className="asset-logo" src={item === 'USDG' ? '/assets/usdg-logo-crop.png' : '/assets/eth-logo-crop.png'} alt={`${item} logo`}/><span><b>{item}</b><small>{item === 'USDG' ? 'Stablecoin' : 'Native asset'}</small></span></button>)}</div><div className="input-label"><label>AMOUNT</label><span>AVAILABLE {asset === 'USDG' ? (walletBalances?.usdg ?? '—') : (walletBalances?.eth ?? '—')} {asset}</span></div><div className="amount"><input value={amount} onChange={(event) => setAmount(event.target.value)}/><b>{asset}</b><button onClick={() => setAmount(asset === 'USDG' ? (walletBalances?.usdg ?? '') : (walletBalances?.eth ?? ''))}>MAX</button></div><button className="action" disabled={txPending || !connected} onClick={deposit}>{txPending ? 'Waiting for confirmation…' : connected ? `Deposit ${value.toLocaleString()} ${asset}` : 'Connect wallet to deposit'} <em>↗</em></button></div>
        <div id="lock" className="yield-panel"><div className="section-head"><div><small>02 / PUT IT TO WORK</small><h2>Choose your horizon.</h2></div></div><p className="section-copy">Choose a lock horizon for your position.</p><div className="mode-list">{MODES.map((item) => <button className={mode === item.id ? 'selected' : ''} onClick={() => setMode(item.id)} key={item.id}><span><b>{item.name}</b><small>{item.detail}</small></span><strong>{item.apy[asset].toFixed(2)}%</strong></button>)}</div><div className="yield-readout"><span>ESTIMATED YEARLY YIELD</span><b>+{displayYearly.toLocaleString(undefined, { maximumFractionDigits: 6 })} {asset}</b><small>At {displayApy.toFixed(2)}% APY · {selected.detail}</small></div><div className="lock-meta"><span>UNLOCK DATE <b>{mode === '90d' ? '90 DAY LOCK' : mode === '7d' ? '7 DAY LOCK' : 'ANYTIME'}</b></span><span>RATE TYPE <b>FIXED</b></span></div><button className="secondary" onClick={() => notify(connected ? 'Select an amount and deposit to create your position' : 'Connect wallet to lock capital')}>Lock into yield <em>↗</em></button></div>
      </section>

      <section id="rewards" className="telemetry"><div className="section-head"><div><small>03 / REWARD STREAM</small><h2>Watch your earnings.</h2></div><span className="telemetry-note">{connected ? 'POSITION REWARD' : 'CONNECT WALLET'}</span></div><div className="reward-panel"><div><span className="reward-label">LIVE ACCRUED REWARD</span><strong>{position?.pending ?? '—'} {asset}</strong><small>Stake {asset} to earn rewards in {asset}.</small></div><div className="reward-formula"><span>REWARD ASSET</span><b>{asset}</b><small>Read from the deployed vault position.</small><div className="reward-actions"><button className="secondary" disabled={txPending || !connected} onClick={claimReward}>Claim {asset}</button><button className="secondary" disabled={txPending || !connected} onClick={withdraw}>Withdraw {asset}</button></div></div></div></section>

    </main>
    <footer><b>OWN VAULT</b><span>PRIVATE YIELD SYSTEM / v0.1</span><span>STATUS <i/> OPERATIONAL</span><span>© 2026</span></footer>
    {toast && <div className="toast">{toast}</div>}
  </div>
}

createRoot(document.getElementById('root')).render(<App/>)
