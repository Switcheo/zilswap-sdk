import { Transaction, TxReceipt as _TxReceipt, Wallet } from '@zilliqa-js/account'
import { CallParams, Contract, Value } from '@zilliqa-js/contract'
import { TransactionError } from '@zilliqa-js/core'
import { fromBech32Address, toBech32Address } from '@zilliqa-js/crypto'
import { MessageType, NewEventSubscription, StatusType } from '@zilliqa-js/subscriptions'
import { BN, Long, units } from '@zilliqa-js/util'
import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Mutex } from 'async-mutex'
import { BigNumber } from 'bignumber.js'
import 'isomorphic-fetch'

import { BatchRequest, sendBatchRequest } from '../batch'
import { APIS, BASIS, CHAIN_VERSIONS, Network, WSS, ZILSWAPV2_CONTRACTS, ZIL_HASH } from '../constants'
import { isLocalStorageAvailable, toPositiveQa, unitlessBigNumber } from '../utils'
import { OnStateUpdate, Zilo } from '../zilo'
import { LONG_ALPHA, PRECISION, SHORT_ALPHA } from './utils'

import POOL_CODE from "./contracts/ZilSwapPool.scilla"

declare module '*.scilla' {}

export { Network }

BigNumber.config({ EXPONENTIAL_AT: 1e9 }) // never!

const BN_ZERO = new BigNumber(0)
const ONE_IN_BPS = new BigNumber(10000)

export type Options = {
  deadlineBuffer?: number
  gasPrice?: number
  gasLimit?: number
  rpcEndpoint?: string
}

export type OnUpdate = (tx: ObservedTx, status: TxStatus, receipt?: TxReceipt) => void

export type ObservedTx = {
  hash: string
  deadline: number
}

// The tx status of an observed tx.
// Confirmed = txn was found, confirmed and processed without reverting
// Rejected = txn was found, confirmed, but had an error and reverted during smart contract execution
// Expired = current block height has exceeded the txn's deadline block
export type TxStatus = 'confirmed' | 'rejected' | 'expired'

export type TxReceipt = _TxReceipt

export type TxParams = {
  version: number
  gasPrice: BN
  gasLimit: Long
}

export type TokenPath = {
  tokenIn: string
  tokenOut: string
}

export type TokenDetails = {
  contract: Contract // instance
  address: string
  hash: string
  name: string
  symbol: string
  decimals: number
}

export type AppState = {
  routerState: RouterState // router contract state
  pools: { [index: string]: Pool } // poolHash => poolState mapping
  tokens: { [index: string]: TokenDetails } // pool tokens & LP tokens => TokenDetails mapping
  currentUser: string | null
  currentNonce?: number | null
  currentZILBalance?: BigNumber | null // User'z zil balance
}

/* V2 Router contract */
export type RouterState = {
  all_pools: string[]
}

/* V2 Pool contract */
export type PoolState = {
  factory: string
  token0: string
  token1: string

  reserve0: string
  reserve1: string
  amp_bps: string
  r_factor_in_precision: string

  v_reserve0: string
  v_reserve1: string

  k_last: string
  current_block_volume: string
  short_ema: string
  long_ema: string
  last_trade_block: string

  total_supply: string
  balances: { [index: string]: string }
  allowances: { [index: string]: { [key2 in string]?: string } }
}

export type Pool = {
  poolHash: string
  poolAddress: string

  token0Address: string
  token1Address: string
  ampBps: BigNumber

  token0Reserve: BigNumber
  token1Reserve: BigNumber

  token0vReserve: BigNumber
  token1vReserve: BigNumber

  exchangeRate: BigNumber // the zero slippage exchange rate
  totalSupply: BigNumber

  contractState: PoolState
}

export type WalletProvider = Omit<
  Zilliqa & { wallet: Wallet & { net: string; defaultAccount: { base16: string; bech32: string } } }, // ugly hack for zilpay non-standard API
  'subscriptionBuilder'
>

type RPCBalanceResponse = { balance: string; nonce: string }

export class ZilSwapV2 {
  /* Zilliqa SDK */
  readonly zilliqa: Zilliqa

  /* Internals */
  private readonly rpcEndpoint: string
  private readonly walletProvider?: WalletProvider // zilpay
  private appState?: AppState

  /* Txn observers */
  private subscription: NewEventSubscription | null = null
  private observer: OnUpdate | null = null
  private observerMutex: Mutex
  private observedTxs: ObservedTx[] = []

  /* Deadline tracking */
  private deadlineBuffer: number = 3
  private currentBlock: number = -1

  /* ZilswapV2 Router contract attributes */
  readonly contract: Contract
  readonly contractAddress: string // router address in bech32
  readonly contractHash: string // router address in hex

  /* Zilswap initial launch offerings */
  readonly zilos: { [address: string]: Zilo }

  /* Transaction attributes */
  readonly _txParams: TxParams = {
    version: -1,
    gasPrice: new BN(0),
    gasLimit: Long.fromNumber(80000),
  }

  /**
   * Creates the ZilswapV2 SDK object. {@linkcode initalize} needs to be called after
   * the object is created to begin watching the blockchain's state.
   *
   * @param network the Network to use, either `TestNet` or `MainNet`.
   * @param walletProviderOrKey a Provider with Wallet or private key string to be used for signing txns.
   * @param options a set of Options that will be used for all txns.
   */
  constructor(readonly network: Network, walletProviderOrKey?: WalletProvider | string, options?: Options) {
    this.rpcEndpoint = options?.rpcEndpoint || APIS[network]
    if (typeof walletProviderOrKey === 'string') {
      this.zilliqa = new Zilliqa(this.rpcEndpoint)
      this.zilliqa.wallet.addByPrivateKey(walletProviderOrKey)
    } else if (walletProviderOrKey) {
      this.zilliqa = new Zilliqa(this.rpcEndpoint, walletProviderOrKey.provider)
      this.walletProvider = walletProviderOrKey
    } else {
      this.zilliqa = new Zilliqa(this.rpcEndpoint)
    }

    this.contractAddress = ZILSWAPV2_CONTRACTS[network]
    this.contract = (this.walletProvider || this.zilliqa).contracts.at(this.contractAddress)
    this.contractHash = fromBech32Address(this.contractAddress).toLowerCase()
    this.zilos = {}
    this._txParams.version = CHAIN_VERSIONS[network]

    if (options) {
      if (options.deadlineBuffer && options.deadlineBuffer > 0) this.deadlineBuffer = options.deadlineBuffer
      if (options.gasPrice && options.gasPrice > 0) this._txParams.gasPrice = toPositiveQa(options.gasPrice, units.Units.Li)
      if (options.gasLimit && options.gasLimit > 0) this._txParams.gasLimit = Long.fromNumber(options.gasLimit)
    }

    this.observerMutex = new Mutex()
  }

  /**
   * Intializes the SDK, fetching a cache of the ZilswapV2 contract state and
   * subscribing to subsequent state changes. You may optionally pass an array
   * of ObservedTx's to subscribe to status changes on any of those txs.
   *
   * @param subscription is the callback function to call when a tx state changes.
   * @param observedTx is the array of txs to observe.
   */
  public async initialize(subscription?: OnUpdate, observeTxs: ObservedTx[] = []) {
    this.observedTxs = observeTxs
    if (subscription) this.observer = subscription
    if (this._txParams.gasPrice.isZero()) {
      const minGasPrice = await this.zilliqa.blockchain.getMinimumGasPrice()
      if (!minGasPrice.result) throw new Error('Failed to get min gas price.')
      this._txParams.gasPrice = new BN(minGasPrice.result)
    }

    await this.updateBlockHeight()
    await this.updateAppState()
    await this.updateZILBalanceAndNonce()
    this.subscribeToAppChanges()
  }

  /**
   * Initializes a new Zilo instance and registers it to the ZilSwap SDK,
   * subscribing to subsequent state changes in the Zilo instance. You may
   * optionally pass a state observer to subscribe to state changes of this
   * particular Zilo instance.
   *
   * If the Zilo instance is already registered, no new instance will be
   * created. If a new state observer is provided, it will overwrite the
   * existing one.
   *
   * @param address is the Zilo contract address which can be given by
   * either hash (0x...) or bech32 address (zil...).
   * @param onStateUpdate is the state observer which triggers when state
   * updates
   */
  public async registerZilo(address: string, onStateUpdate?: OnStateUpdate): Promise<Zilo> {
    const byStr20Address = this.getHash(address)

    if (this.zilos[byStr20Address]) {
      this.zilos[byStr20Address].updateObserver(onStateUpdate)
      return this.zilos[byStr20Address]
    }

    const zilo = new Zilo(this, byStr20Address)
    await zilo.initialize(onStateUpdate)
    this.zilos[byStr20Address] = zilo

    this.subscribeToAppChanges()

    return zilo
  }

  /**
   * Deregisters an existing Zilo instance. Does nothing if provided
   * address is not already registered.
   *
   * @param address is the Zilo contract address which can be given by
   * either hash (0x...) or bech32 address (zil...).
   */
  public deregisterZilo(address: string) {
    const byStr20Address = this.getHash(address)

    if (!this.zilos[byStr20Address]) {
      return
    }

    delete this.zilos[address]

    this.subscribeToAppChanges()
  }

  /**
   * Deploys new pool contract and add to router by calling the `AddPool` transition on the router.
   * The new pool contract deployed will consist of token0 and token1, given by token0ID and token1ID.
   * 
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   *
   * @param token0ID is the hash (0x...) or bech32 address (zil...) of the token 
   * which matches the init_token0 of the pool.
   * @param token1ID is the hash (0x...) or bech32 address (zil...) of the token 
   * which matches the init_token1 of the pool.
   * @param initAmpBps is amplification factor of the pool given in given in 
   * {@link https://www.investopedia.com/terms/b/basispoint.asp basis points}.
   * 10000 basis points = 100%
   */
  public async deployAndAddPool(token0ID: string, token1ID: string, initAmpBps: string): Promise<(Contract | ObservedTx)[]> {
    // Check logged in
    this.checkAppLoadedWithUser()

    let token0Hash = this.getHash(token0ID)
    let token1Hash = this.getHash(token1ID)

    if (parseInt(token0Hash, 16) > parseInt(token1Hash, 16)) [token0Hash, token1Hash] = [token1Hash, token0Hash]

    const token0Contract: Contract = this.getContract(token0Hash)
    const token1Contract: Contract = this.getContract(token1Hash)

    const t0State = await this.fetchContractInit(token0Contract)
    const t1State = await this.fetchContractInit(token1Contract)

    const pair = `${t0State.find((i: Value) => i.vname == 'symbol').value}-${t1State.find((i: Value) => i.vname == 'symbol').value}`
    const name = `ZilSwap V2 ${pair} LP Token`
    const symbol = `ZWAPv2LP.${pair}`

    const init = [
      this.param('_scilla_version', 'Uint32', '0'),
      this.param('init_token0', 'ByStr20', token0Hash),
      this.param('init_token1', 'ByStr20', token1Hash),
      this.param('init_factory', 'ByStr20', this.contractHash),
      this.param('init_amp_bps', 'Uint128', initAmpBps),
      this.param('contract_owner', 'ByStr20', this.contractHash),
      this.param('name', 'String', name),
      this.param('symbol', 'String', symbol),
      this.param('decimals', 'Uint32', '12'),
      this.param('init_supply', 'Uint128', '0'),
    ];

    // Deploy pool
    const pool = await this.deployPoolContract(init)

    // Add pool
    const tx = await this.addPool(pool.address!.toLowerCase())

    return [pool, tx]
  }

  /**
   * Deploys new pool contract only, without adding to the router.
   * The new pool contract deployed will consist of token0 and token1, given by token0ID and token1ID.
   * 
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   *
   * @param token0ID is the hash (0x...) or bech32 address (zil...) of the token which matches the init_token0 of the pool.
   * @param token1ID is the hash (0x...) or bech32 address (zil...) of the token which matches the init_token1 of the pool.
   * @param initAmpBps is amplification factor of the pool given in given in 
   * {@link https://www.investopedia.com/terms/b/basispoint.asp basis points}.
   * 10000 = 100%
   */
  public async deployPool(token0ID: string, token1ID: string, initAmpBps: string): Promise<Contract> {
    // Check logged in
    this.checkAppLoadedWithUser()

    let token0Hash = this.getHash(token0ID)
    let token1Hash = this.getHash(token1ID)

    if (parseInt(token0Hash, 16) > parseInt(token1Hash, 16)) [token0Hash, token1Hash] = [token1Hash, token0Hash]

    const token0Contract: Contract = this.getContract(token0Hash)
    const token1Contract: Contract = this.getContract(token1Hash)

    const t0State = await this.fetchContractInit(token0Contract)
    const t1State = await this.fetchContractInit(token1Contract)

    const pair = `${t0State.find((i: Value) => i.vname == 'symbol').value}-${t1State.find((i: Value) => i.vname == 'symbol').value}`
    const name = `ZilSwap V2 ${pair} LP Token`
    const symbol = `ZWAPv2LP.${pair}`

    const init = [
      this.param('_scilla_version', 'Uint32', '0'),
      this.param('init_token0', 'ByStr20', token0Hash),
      this.param('init_token1', 'ByStr20', token1Hash),
      this.param('init_factory', 'ByStr20', this.contractHash),
      this.param('init_amp_bps', 'Uint128', initAmpBps),
      this.param('contract_owner', 'ByStr20', this.contractHash),
      this.param('name', 'String', name),
      this.param('symbol', 'String', symbol),
      this.param('decimals', 'Uint32', '12'),
      this.param('init_supply', 'Uint128', '0'),
    ];

    // Call deployContract
    const pool = await this.deployPoolContract(init)
    return pool
  }

  /**
   * Adds a deployed pool contract to the router by calling the `AddPool` transition.
   * 
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   *
   * @param pool is the hash (0x...) or bech32 address (zil...) of the pool to be added to the router.
   */
  public async addPool(pool: string): Promise<ObservedTx> {
    // Check logged in
    this.checkAppLoadedWithUser()

    let poolHash = this.getHash(pool)

    const contract: Contract = this.contract
    const args: any = [
      this.param('pool', 'ByStr20', poolHash)
    ]
    const params: CallParams = {
      amount: new BN(0),
      ...this.txParams()
    }
    const addPoolTx = await this.callContract(contract, 'AddPool', args, params, true)

    if (!addPoolTx.id) {
      throw new Error(JSON.stringify('Failed to get tx id!', null, 2))
    }

    // Add to observedTx
    const deadline = this.deadlineBlock()
    const observeTxn = {
      hash: addPoolTx.id!,
      deadline,
    }
    await this.observeTx(observeTxn)
    return observeTxn
  }

  /**
   * Adds liquidity to the pool by transferring a ZRC-2 token-pair given by tokenAID and tokenBID.
   * The pool must consist of the tokenA and tokenB.
   * 
   * Note that pools can only contain ZRC-2 tokens.
   * 
   * The desired amount of tokenA and tokenB added to the pool is given by `amountADesiredStr` and `amountBDesiredStr`.
   * The minimum amount of tokenA and tokenB to add to the pool is given by `amountAMinStr` and `amountBMinStr`.
   * 
   * If the pool has no liquidity yet, the token amount added will be based on `amountADesiredStr` and `amountBDesiredStr`.
   * Else, the amount of tokens to be added will be calculated and transferred to the pool. The amount of tokenA and tokenB
   * to be added to the pool must be larger or equal to `amountAMinStr` and `amountBMinStr`.
   * 
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param tokenAID is the hash (0x...) or bech32 address (zil...) of the token added to the pool.
   * @param tokenBID is the hash (0x...) or bech32 address (zil...) of the other token added to the pool.
   * @param poolID is the hash (0x...) or bech32 address (zil...) of the pool to add liquidity to.
   * @param amountADesiredStr is the target amount of tokenA to contribute to the pool as a unitless string (integer, no decimals).
   * @param amountBDesiredStr is the target amount of tokenB to contribute to the pool as a unitless string (integer, no decimals).
   * @param amountAMinStr is the minimum amount of tokenA to contribute to the pool as a unitless string (integer, no decimals).
   * @param amountBMinStr is the minimum amount of tokenB to contribute to the pool as a unitless string (integer, no decimals).
   * @param reserve_ratio_allowance is the allowed pool token reserve ratio in percentage. Default value is 5%
   */
  public async addLiquidity(
    tokenAID: string,
    tokenBID: string,
    poolID: string,
    amountADesiredStr: string,
    amountBDesiredStr: string,
    amountAMinStr: string,
    amountBMinStr: string,
    vReserveLowerBound: string = '0', // default 0, need to pass in for ampPool
    vReserveUpperBound: string = '0', // default 0, need to pass in for ampPool
  ): Promise<ObservedTx> {
    if (tokenAID === tokenBID) {
      throw new Error("Invalid Token Pair")
    }

    this.checkAppLoadedWithUser()

    const tokenAHash = this.getHash(tokenAID)
    const tokenBHash = this.getHash(tokenBID)
    const poolHash = this.getHash(poolID)

    // Get the most updated pool state
    await this.updateSinglePoolState(poolHash)

    const pool = this.getAppState().pools[poolHash]

    if (!pool)
      throw new Error("Pool does not exist");

    // Calculate amount of tokens added
    const reserveA = pool.contractState.reserve0
    const reserveB = pool.contractState.reserve1
    const amountADesired = unitlessBigNumber(amountADesiredStr)
    const amountBDesired = unitlessBigNumber(amountBDesiredStr)
    const amountAMin = unitlessBigNumber(amountAMinStr)
    const amountBMin = unitlessBigNumber(amountBMinStr)
    let amountA, amountB

    if (reserveA === '0' && reserveB === '0') {
      amountA = amountADesired
      amountB = amountBDesired
    }
    else {
      const amountBOptimal = this.quote(amountADesired, reserveA, reserveB)
      if (amountBOptimal.lte(amountBDesired)) {
        amountA = amountADesired
        amountB = amountBOptimal
      }
      else {
        const amountAOptimal = this.quote(amountBDesired, reserveB, reserveA)
        amountA = amountAOptimal
        amountB = amountBDesired
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(tokenAHash, amountA)
    await this.checkAllowance(tokenBHash, amountB)
    await this.checkBalance(tokenAHash, amountA)
    await this.checkBalance(tokenBHash, amountB)

    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('tokenA', 'ByStr20', tokenAHash),
      this.param('tokenB', 'ByStr20', tokenBHash),
      this.param('pool', 'ByStr20', poolHash),
      this.param('amountA_desired', 'Uint128', amountADesired.toString()),
      this.param('amountB_desired', 'Uint128', amountBDesired.toString()),
      this.param('amountA_min', 'Uint128', amountAMin.toString()),
      this.param('amountB_min', 'Uint128', amountBMin.toString()),
      this.param('v_reserve_ratio_bounds', 'Pair (Uint256) (Uint256)',
        {
          "constructor": "Pair",
          "argtypes": ["Uint256", "Uint256"],
          "arguments": [`${vReserveLowerBound}`, `${vReserveUpperBound}`]
        }),
      this.param('deadline_block', 'BNum', `${deadline}`)
    ]
    const params: CallParams = {
      amount: new BN(0),
      ...this.txParams()
    }

    // Call contract
    const addLiquidityTxn = await this.callContract(contract, 'AddLiquidity', args, params, true)

    if (addLiquidityTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: addLiquidityTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Adds liquidity to the pool. One of the token added is wZIL, while the other is a specified ZRC-2 token.
   * The pool must consist of the token and wZIL.
   * 
   * Note that pools can only contain ZRC-2 tokens. Hence, pools can only contain wZIL, and not ZIL. However, users are still able to add 
   * liquidity using ZIL. The user will transfer ZIL to the router. The router accepts user's ZIL and wraps it to wZIL before transferring 
   * to the pool as wZIL.
   * 
   * The desired amount of token and wZIL added to the pool is given by `amountTokenDesiredStr` and `amountwZILDesiredStr`.
   * The minimum amount of token and wZIL to add to the pool is given by `amountTokenMinStr` and `amountWZILMinStr`.
   * 
   * If the pool has no liquidity yet, the token amount added will be based on `amountTokenDesiredStr` and `amountwZILDesiredStr`.
   * Else, the amount of tokens to be added will be calculated and transferred to the pool. The amount of token and wZIL
   * to be added to the pool must be larger or equal to `amountAMinStr` and `amountBMinStr`.
   * 
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param tokenID is the hash (0x...) or bech32 address (zil...) of the token added to the pool.
   * @param poolID is the hash (0x...) or bech32 address (zil...) of the pool to add liquidity to.
   * @param amountTokenDesiredStr is the target amount of token to contribute to the pool as a unitless string (integer, no decimals).
   * @param amountwZILDesiredStr is the target amount of wZIL to contribute to the pool as a unitless string (integer, no decimals).
   * @param amountTokenMinStr is the minimum amount of token to contribute to the pool as a unitless string (integer, no decimals).
   * @param amountWZILMinStr is the minimum amount of wZIL to contribute to the pool as a unitless string (integer, no decimals).
   * @param reserve_ratio_allowance is the allowed pool token reserve ratio in percentage. Default value is 5%
   */
  public async addLiquidityZIL(
    tokenID: string,
    poolID: string,
    amountTokenDesiredStr: string,
    amountwZILDesiredStr: string,
    amountTokenMinStr: string,
    amountWZILMinStr: string,
    vReserveLowerBound: string = '0', // default 0, need to pass in for ampPool
    vReserveUpperBound: string = '0', // default 0, need to pass in for ampPool
  ): Promise<ObservedTx> {
    // Check logged in
    this.checkAppLoadedWithUser()

    const tokenHash = this.getHash(tokenID)
    const poolHash = this.getHash(poolID)

    await this.updateSinglePoolState(poolHash)

    const pool = this.getAppState().pools[poolHash]!

    // Calculate amount of tokens added
    const reserveA = pool.token0Reserve
    const reserveB = pool.token1Reserve
    const amountTokenDesired = unitlessBigNumber(amountTokenDesiredStr)
    const amountwZILDesired = unitlessBigNumber(amountwZILDesiredStr)
    const amountTokenMin = unitlessBigNumber(amountTokenMinStr)
    const amountWZILMin = unitlessBigNumber(amountWZILMinStr)
    let amountToken, amountWZIL

    if (reserveA.isZero() && reserveB.isZero()) {
      amountToken = amountTokenDesired
      amountWZIL = amountwZILDesired
    }
    else {
      const amountWZILOptimal = await this.quote(amountTokenDesired, reserveA, reserveB)
      if (amountWZILOptimal.lte(amountwZILDesired)) {
        amountToken = amountTokenDesired
        amountWZIL = amountWZILOptimal
      }
      else {
        const amountTokenOptimal = await this.quote(amountwZILDesired, reserveB, reserveA)
        amountToken = amountTokenOptimal
        amountWZIL = amountwZILDesired
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(tokenHash, amountToken)
    await this.checkBalance(tokenHash, amountToken)
    await this.checkBalance(ZIL_HASH, amountWZIL)

    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('token', 'ByStr20', tokenHash),
      this.param('pool', 'ByStr20', poolHash),
      this.param('amount_token_desired', 'Uint128', amountTokenDesired.toString()),
      this.param('amount_token_min', 'Uint128', amountTokenMin.toString()),
      this.param('amount_wZIL_min', 'Uint128', amountWZILMin.toString()),
      this.param('v_reserve_ratio_bounds', 'Pair (Uint256) (Uint256)',
        {
          "constructor": "Pair",
          "argtypes": ["Uint256", "Uint256"],
          "arguments": [`${vReserveLowerBound}`, `${vReserveUpperBound}`]
        }),
      this.param('deadline_block', 'BNum', `${deadline}`),
    ]
    const params: CallParams = {
      amount: new BN(amountwZILDesired.toString()),
      ...this.txParams()
    }

    // Call contract
    const addLiquidityZilTxn = await this.callContract(contract, 'AddLiquidityZIL', args, params, true)

    if (addLiquidityZilTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: addLiquidityZilTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Remove liquidity from the pool. 
   * Users will transfer their LP tokens to the pool. Pool burns LP tokens and transfers the ZRC-2 token pair 
   * (given by `tokenAID` and `tokenBID`) back to the user.
   * 
   * The minimum amount of tokenA and tokenB to be received is given by `amountAMinStr` and `amountBMinStr` respectively.
   * The amount of ZRC-2 tokens received is calculated based on the pool reserves.
   * 
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param tokenAID is the hash (0x...) or bech32 address (zil...) of the tokenA added to the pool.
   * @param tokenBID is the hash (0x...) or bech32 address (zil...) of the tokenB added to the pool.
   * @param poolID is the hash (0x...) or bech32 address (zil...) of the pool to remove liquidity from.
   * @param liquidityStr is the target amount of LP tokens to send back to the pool to burn, as a unitless string (integer, no decimals).
   * @param amountAMinStr is the minimum amount of tokenA to receive from the pool as a unitless string (integer, no decimals).
   * @param amountBMinStr is the minimum amount of tokenB to receive from the pool as a unitless string (integer, no decimals).
   */
  public async removeLiquidity(
    tokenAID: string,
    tokenBID: string,
    poolID: string,
    liquidityStr: string,
    amountAMinStr: string,
    amountBMinStr: string
  ): Promise<ObservedTx> {
    if (tokenAID === tokenBID) {
      throw new Error("Invalid Token Pair")
    }

    const tokenAHash = this.getHash(tokenAID)
    const tokenBHash = this.getHash(tokenBID)
    const poolHash = this.getHash(poolID)
    const liquidity = unitlessBigNumber(liquidityStr)
    const amountAMin = unitlessBigNumber(amountAMinStr)
    const amountBMin = unitlessBigNumber(amountBMinStr)

    const poolState = this.getAppState().pools[poolHash]
    if (!poolState) {
      throw new Error('Pool does not exist')
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // // Localhost
    // await this.updateBlockHeight()

    // Check Balance and Allowance
    await this.checkAllowance(poolHash, liquidity)
    await this.checkBalance(poolHash, liquidity)

    // Generate contract args
    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('tokenA', 'ByStr20', tokenAHash),
      this.param('tokenB', 'ByStr20', tokenBHash),
      this.param('pool', 'ByStr20', poolHash),
      this.param('liquidity', 'Uint128', liquidity.toString()),
      this.param('amountA_min', 'Uint128', amountAMin.toString()),
      this.param('amountB_min', 'Uint128', amountBMin.toString()),
      this.param('deadline_block', 'BNum', `${deadline}`)
    ]
    const params: CallParams = {
      amount: new BN(0),
      ...this.txParams()
    }

    // Call contract
    const removeLiquidityTxn = await this.callContract(contract, 'RemoveLiquidity', args, params, true)

    if (removeLiquidityTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: removeLiquidityTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Remove liquidity from the pool. 
   * User transfers LP tokens to the pool. Pool burns LP tokens and transfers the tokens back to the user. User receives ZIL as one of the tokens.
   *
   * The minimum amount of token and ZIL to be received is given by `amountTokenMinStr` and `amountWZILMinStr` respectively.
   * The amount of tokens received is calculated based on the pool reserves.
   * 
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   * 
   * @param tokenID is the hash (0x...) or bech32 address (zil...) of the token added to the pool.
   * @param poolID is the hash (0x...) or bech32 address (zil...) of the pool to remove liquidity from.
   * @param liquidityStr is the target amount of LP tokens to send back to the pool to burn, as a unitless string (integer, no decimals).
   * @param amountTokenMinStr is the minimum amount of token to receive from the pool as a unitless string (integer, no decimals).
   * @param amountWZILMinStr is the minimum amount of wZIL to receive from the pool as a unitless string (integer, no decimals).
   */
  public async removeLiquidityZIL(
    tokenID: string,
    poolID: string,
    liquidityStr: string,
    amountTokenMinStr: string,
    amountWZILMinStr: string
  ): Promise<ObservedTx> {
    const tokenHash = this.getHash(tokenID)
    const poolHash = this.getHash(poolID)

    const poolState = this.getAppState().pools[poolHash]
    if (!poolState) {
      throw new Error('Pool does not exist')
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // // Localhost
    // await this.updateBlockHeight()

    const liquidity = unitlessBigNumber(liquidityStr)
    const amountTokenMin = unitlessBigNumber(amountTokenMinStr)
    const amountWZILMin = unitlessBigNumber(amountWZILMinStr)

    // Check Balance and Allowance
    await this.checkAllowance(poolHash, liquidity)
    await this.checkBalance(poolHash, liquidity)

    // Generate contract args
    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('token', 'ByStr20', tokenHash),
      this.param('pool', 'ByStr20', poolHash),
      this.param('liquidity', 'Uint128', liquidity.toString()),
      this.param('amount_token_min', 'Uint128', amountTokenMin.toString()),
      this.param('amount_wZIL_min', 'Uint128', amountWZILMin.toString()),
      this.param('deadline_block', 'BNum', `${deadline}`),
    ]
    const params: CallParams = {
      amount: new BN(0),
      ...this.txParams()
    }

    // Call contract
    const removeLiquidityZilTxn = await this.callContract(contract, 'RemoveLiquidityZIL', args, params, true)

    if (removeLiquidityZilTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: removeLiquidityZilTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Swaps an exact amount of ZRC-2 token with `tokenInID` for another ZRC-2 token.
   * 
   * Depending on the path provided, the SDK calls the corresponding transition `SwapExactTokensForTokensOnce`, 
   * `SwapExactTokensForTokensTwice`, `SwapExactTokensForTokensThrice` on the router. A maximum of swaps over 3 pools are allowed
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param path is the array of Pool structs representing the pool path
   * @param tokenInID is the token ID to be sent to pool (sold), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountInStr is the exact amount of ZRC-2 tokens to add to the pool as a unitless string (integer, no decimals).
   * @param amountOutStr is the amount of ZRC-2 tokens users expect to receive from the pool as a unitless string (integer, no decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to formula used by contract) that the
   * transition will allow before reverting.
   */
  public async swapExactTokensForTokens(
    path: Pool[],
    tokenInID: string,
    amountInStr: string,
    amountOutStr: string,
    maxAdditionalSlippage: number = 200,
  ): Promise<ObservedTx> {
    if (!path.length)
      throw new Error("Invalid swap path");

    this.checkAppLoadedWithUser()

    const amountOutMin = unitlessBigNumber(amountOutStr).times(BASIS).dividedToIntegerBy(BASIS + maxAdditionalSlippage)
    const amountIn = unitlessBigNumber(amountInStr)
    if (amountOutMin.isLessThan(0) || amountIn.isLessThan(0)) { throw new Error("Invalid amountOutMin or amountIn") }

    const tokenInHash = this.getHash(tokenInID);
    const tokenPath = this.getTokenPath(path, tokenInHash);

    // Check Balance and Allowance
    await this.checkAllowance(tokenInHash, amountIn)
    await this.checkBalance(tokenInHash, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (path.length === 1) {
      txn = {
        transition: "SwapExactTokensForTokensOnce",
        args: [
          this.param('amount_in', 'Uint128', amountIn.toString()),
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          this.param('pool', 'ByStr20', path[0].poolHash),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0][0]}`, `${tokenPath[0][1]}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 2) {
      txn = {
        transition: "SwapExactTokensForTokensTwice",
        args: [
          this.param('amount_in', 'Uint128', amountIn.toString()),
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 3) {
      txn = {
        transition: "SwapExactTokensForTokensThrice",
        args: [
          this.param('amount_in', 'Uint128', amountIn.toString()),
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("Please try again. Or increase slippage")
    }

    const swapExactTokensForZILTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapExactTokensForZILTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapExactTokensForZILTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Swaps some ZRC-2 token with `tokenInID` for an exact amount of ZRC-2 token.
   *
   * Depending on the path provided, the SDK calls the corresponding transition `SwapTokensForExactTokensOnce`, 
   * `SwapTokensForExactTokensTwice`, `SwapTokensForExactTokensThrice` on the router. A maximum of swaps over 3 pools are allowed
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param path is the array of Pool structs representing the pool path
   * @param tokenInID is the token ID to be sent to pool (sold), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountInStr is the amount of ZRC-2 tokens users expect to add to the pool as a unitless string (integer, no decimals).
   * @param amountOutStr is the exact amount of ZRC-2 tokens to receive from the pool as a unitless string (integer, no decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to formula used by contract) that the
   * transition will allow before reverting.
   */
  public async swapTokensForExactTokens(
    path: Pool[],
    tokenInID: string,
    amountInStr: string,
    amountOutStr: string,
    maxAdditionalSlippage: number = 200,
  ): Promise<ObservedTx> {
    if (!path.length)
      throw new Error("Invalid swap path");

    this.checkAppLoadedWithUser()

    const amountInMax = unitlessBigNumber(amountInStr).times(BASIS + maxAdditionalSlippage).dividedToIntegerBy(BASIS)
    const amountOut = unitlessBigNumber(amountOutStr)
    if (amountInMax.isLessThan(0) || amountOut.isLessThan(0)) { throw new Error("Invalid amountInMax or amountOut") }

    const tokenInHash = this.getHash(tokenInID);
    const tokenPath = this.getTokenPath(path, tokenInHash);

    // Check Balance and Allowance
    await this.checkAllowance(tokenInHash, amountInMax)
    await this.checkBalance(tokenInHash, amountInMax)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (path.length === 1) {
      txn = {
        transition: "SwapTokensForExactTokensOnce",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          this.param('amount_in_max', 'Uint128', amountInMax.toString()),
          this.param('pool', 'ByStr20', path[0].poolHash),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0][0]}`, `${tokenPath[0][1]}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 2) {
      txn = {
        transition: "SwapTokensForExactTokensTwice",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          this.param('amount_in_max', 'Uint128', amountInMax.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 3) {
      txn = {
        transition: "SwapTokensForExactTokensThrice",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          this.param('amount_in_max', 'Uint128', amountInMax.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("Please try again. Or increase slippage")
    }

    const swapTokensForExactTokensTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapTokensForExactTokensTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapTokensForExactTokensTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Swaps an exact amount of ZRC-2 token with `tokenInID` for ZIL.
   * 
   * Depending on the path provided, the SDK calls the corresponding transition `SwapExactTokensForZILOnce`, 
   * `SwapExactTokensForZILTwice`, `SwapExactTokensForZILThrice` on the router. A maximum of swaps over 3 pools are allowed
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param path is the array of Pool structs representing the pool path
   * @param tokenInID is the token ID to be sent to pool (sold), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountInStr is the exact amount of ZRC-2 tokens to add to the pool as a unitless string (integer, no decimals).
   * @param amountOutStr is the amount of ZIL users expect to receive from the pool as a unitless string (integer, no decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to formula used by contract) that the
   * transition will allow before reverting.
   */
  public async swapExactTokensForZIL(
    path: Pool[],
    tokenInID: string,
    amountInStr: string,
    amountOutStr: string,
    maxAdditionalSlippage: number = 200,
  ): Promise<ObservedTx> {
    if (!path.length)
      throw new Error("Invalid swap path");

    this.checkAppLoadedWithUser()

    const amountOutMin = unitlessBigNumber(amountOutStr).times(BASIS).dividedToIntegerBy(BASIS + maxAdditionalSlippage)
    const amountIn = unitlessBigNumber(amountInStr)
    if (amountOutMin.isLessThan(0) || amountIn.isLessThan(0)) { throw new Error("Invalid amountOutMin or amountIn") }

    const tokenInHash = this.getHash(tokenInID);
    const tokenPath = this.getTokenPath(path, tokenInHash);

    // Check Balance and Allowance
    await this.checkAllowance(tokenInHash, amountIn)
    await this.checkBalance(tokenInHash, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (path.length === 1) {
      txn = {
        transition: "SwapExactTokensForZILOnce",
        args: [
          this.param('amount_in', 'Uint128', amountIn.toString()),
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          this.param('pool', 'ByStr20', path[0].poolHash),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0][0]}`, `${tokenPath[0][1]}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 2) {
      txn = {
        transition: "SwapExactTokensForZILTwice",
        args: [
          this.param('amount_in', 'Uint128', amountIn.toString()),
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 3) {
      txn = {
        transition: "SwapExactTokensForZILThrice",
        args: [
          this.param('amount_in', 'Uint128', amountIn.toString()),
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("Please try again. Or increase slippage")
    }

    const swapTokensForExactZILTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapTokensForExactZILTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapTokensForExactZILTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Swaps some ZRC-2 token with `tokenInID` for an exact amount of ZIL.
   *
   * Depending on the path provided, the SDK calls the corresponding transition `SwapTokensForExactZILOnce`, 
   * `SwapTokensForExactZILTwice`, `SwapTokensForExactZILThrice` on the router. A maximum of swaps over 3 pools are allowed
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param path is the array of Pool structs representing the pool path
   * @param tokenInID is the token ID to be sent to pool (sold), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountInStr is the amount of ZRC-2 tokens users expect to add to the pool as a unitless string (integer, no decimals).
   * @param amountOutStr is the exact amount of ZIL to receive from the pool as a unitless string (integer, no decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to formula used by contract) that the
   * transition will allow before reverting.
   */
  public async swapTokensForExactZIL(
    path: Pool[],
    tokenInID: string,
    amountInStr: string,
    amountOutStr: string,
    maxAdditionalSlippage: number = 200,
  ): Promise<ObservedTx> {
    if (!path.length)
      throw new Error("Invalid swap path");

    this.checkAppLoadedWithUser()

    const amountInMax = unitlessBigNumber(amountInStr).times(BASIS + maxAdditionalSlippage).dividedToIntegerBy(BASIS)
    const amountOut = unitlessBigNumber(amountOutStr)
    if (amountInMax.isLessThan(0) || amountOut.isLessThan(0)) { throw new Error("Invalid amountInMax or amountOut") }

    const tokenInHash = this.getHash(tokenInID);
    const tokenPath = this.getTokenPath(path, tokenInHash);

    // Check Balance and Allowance
    await this.checkAllowance(tokenInHash, amountInMax)
    await this.checkBalance(tokenInHash, amountInMax)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (path.length === 1) {
      txn = {
        transition: "SwapTokensForExactZILOnce",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          this.param('amount_in_max', 'Uint128', amountInMax.toString()),
          this.param('pool', 'ByStr20', path[0].poolHash),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0][0]}`, `${tokenPath[0][1]}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 2) {
      txn = {
        transition: "SwapTokensForExactZILTwice",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          this.param('amount_in_max', 'Uint128', amountInMax.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 3) {
      txn = {
        transition: "SwapTokensForExactZILThrice",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          this.param('amount_in_max', 'Uint128', amountInMax.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("Please try again. Or increase slippage")
    }

    const swapTokensForExactZILTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapTokensForExactZILTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapTokensForExactZILTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Swaps an exact amount of ZIL for for another ZRC-2 token.
   * 
   * Depending on the path provided, the SDK calls the corresponding transition `SwapExactZILForTokensOnce`, 
   * `SwapExactZILForTokensTwice`, `SwapExactZILForTokensThrice` on the router. A maximum of swaps over 3 pools are allowed
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that tokenInID must be that of wZIL.
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param path is the array of Pool structs representing the pool path
   * @param tokenInID is the token ID of wZIL, which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountInStr is the exact amount of ZIL to add to the pool as a unitless string (integer, no decimals).
   * @param amountOutStr is the amount of ZRC-2 tokens users expect to receive from the pool as a unitless string (integer, no decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to formula used by contract) that the
   * transition will allow before reverting.
   */
  public async swapExactZILForTokens(
    path: Pool[],
    tokenInID: string,
    amountInStr: string,
    amountOutStr: string,
    maxAdditionalSlippage: number = 200,
  ): Promise<ObservedTx> {
    if (!path.length)
      throw new Error("Invalid swap path");

    this.checkAppLoadedWithUser()

    const amountOutMin = unitlessBigNumber(amountOutStr).times(BASIS).dividedToIntegerBy(BASIS + maxAdditionalSlippage)
    const amountIn = unitlessBigNumber(amountInStr)
    if (amountOutMin.isLessThan(0) || amountIn.isLessThan(0)) { throw new Error("Invalid amountOutMin or amountIn") }

    const tokenInHash = this.getHash(tokenInID);
    const tokenPath = this.getTokenPath(path, tokenInHash);

    // Check Balance
    await this.checkBalance(ZIL_HASH, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (path.length === 1) {
      txn = {
        transition: "SwapExactZILForTokensOnce",
        args: [
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          this.param('pool', 'ByStr20', path[0].poolHash),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0][0]}`, `${tokenPath[0][1]}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn.toString(10)),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 2) {
      txn = {
        transition: "SwapExactZILForTokensTwice",
        args: [
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn.toString(10)),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 3) {
      txn = {
        transition: "SwapExactZILForTokensThrice",
        args: [
          this.param('amount_out_min', 'Uint128', amountOutMin.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn.toString(10)),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("Please try again. Or increase slippage")
    }

    const swapExactZILForTokensTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapExactZILForTokensTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapExactZILForTokensTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Swaps some ZRC-2 token with `tokenInID` for an exact amount of ZIL.
   *
   * Depending on the path provided, the SDK calls the corresponding transition `SwapZILForExactTokensOnce`, 
   * `SwapZILForExactTokensTwice`, `SwapZILForExactTokensThrice` on the router. A maximum of swaps over 3 pools are allowed
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   * 
   * Note that tokenInID must be that of wZIL.
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param path is the array of Pool structs representing the pool path
   * @param tokenInID is the token ID of wZIL, which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountInStr is the amount of ZIL users expect to add to the pool as a unitless string (integer, no decimals).
   * @param amountOutStr is the exact amount of ZRC-2 tokens to receive from the pool as a unitless string (integer, no decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to formula used by contract) that the
   * transition will allow before reverting.
   */
  public async swapZILForExactTokens(
    path: Pool[],
    tokenInID: string,
    amountInStr: string,
    amountOutStr: string,
    maxAdditionalSlippage: number = 200,
  ): Promise<ObservedTx> {
    if (!path.length)
      throw new Error("Invalid swap path");

    this.checkAppLoadedWithUser()

    const amountInMax = unitlessBigNumber(amountInStr).times(BASIS + maxAdditionalSlippage).dividedToIntegerBy(BASIS)
    const amountOut = unitlessBigNumber(amountOutStr)
    if (amountInMax.isLessThan(0) || amountOut.isLessThan(0)) { throw new Error("Invalid amountInMax or amountOut") }

    const tokenInHash = this.getHash(tokenInID);
    const tokenPath = this.getTokenPath(path, tokenInHash);

    // Check Balance
    await this.checkBalance(ZIL_HASH, amountInMax)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (path.length === 1) {
      txn = {
        transition: "SwapZILForExactTokensOnce",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          this.param('pool', 'ByStr20', path[0].poolHash),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0][0]}`, `${tokenPath[0][1]}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountInMax.toString(10)),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 2) {
      txn = {
        transition: "SwapZILForExactTokensTwice",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountInMax.toString(10)),
          ...this.txParams()
        },
      }
    }
    else if (path.length === 3) {
      txn = {
        transition: "SwapZILForExactTokensThrice",
        args: [
          this.param('amount_out', 'Uint128', amountOut.toString()),
          ...path.map((p, i) => this.param(`pool${i + 1}`, 'ByStr20', p.poolHash)),
          ...tokenPath.map(([t0, t1], i) => this.param(`path${i + 1}`, 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${t0}`, `${t1}`]
          })),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountInMax.toString(10)),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("Please try again. Or increase slippage")
    }

    const swapZILForExactTokensTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapZILForExactTokensTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapZILForExactTokensTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Approves allowing the Zilswap-V2 Router contract to transfer ZRC-2 token with `tokenID`, if the current
   * approved allowance is less than `amount`. If the allowance is sufficient, this method is a no-op.
   *
   * The approval is done by calling `IncreaseAllowance` with the allowance amount as the entire
   * token supply. This is done so that the approval needs to only be done once per token contract,
   * reducing the number of approval transactions required for users conducting multiple swaps.
   *
   * Non-custodial control of the token is ensured by the Zilswap-V2 Router contract itself, which does not
   * allow for the transfer of tokens unless explicitly invoked by the sender.
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on
   * a confirmation or rejection event. The transation will be assumed to be expired after the default
   * deadline buffer, even though there is no deadline block for this transaction.
   *
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @param amountStrOrBN is the required allowance amount the Zilswap contract requires, below which the
   * `IncreaseAllowance` transition is invoked, as a unitless string or BigNumber.
   * @param spenderHash (optional) is the spender contract address, defaults to the ZilSwap contract address.
   *
   * @returns an ObservedTx if IncreaseAllowance was called, null if not.
   */
  public async approveTokenTransferIfRequired(
    tokenID: string,
    amountStrOrBN: BigNumber | string,
    spender: string
  ): Promise<ObservedTx | null> {
    // Check logged in
    this.checkAppLoadedWithUser()

    // // Localhost
    // await this.updateBlockHeight()

    const tokenHash = this.getHash(tokenID)
    const spenderHash = this.getHash(spender)

    const tokenContract = this.getContract(tokenHash)
    const tokenState = await tokenContract.getSubState('allowances', [this.getAppState().currentUser!, spenderHash])
    const allowance = new BigNumber(tokenState?.allowances[this.getAppState().currentUser!]?.[spenderHash] || 0)
    const amount: BigNumber = typeof amountStrOrBN === 'string' ? unitlessBigNumber(amountStrOrBN) : amountStrOrBN

    if (allowance.lte(amount)) {
      try {
        const approveTxn = await this.callContract(
          tokenContract,
          'IncreaseAllowance',
          [
            this.param('spender', 'ByStr20', spenderHash),
            this.param('amount', 'Uint128', new BigNumber(2).pow(128).minus(1).minus(allowance).toString(10))
          ],
          {
            amount: new BN(0),
            ...this.txParams(),
          },
          true
        )

        if (approveTxn.isRejected()) {
          throw new Error('Submitted transaction was rejected.')
        }

        // // Localhost
        // await this.updateZILBalanceAndNonce()

        const observeTxn = {
          hash: approveTxn.id!,
          deadline: this.deadlineBlock(),
        }
        await this.observeTx(observeTxn)

        // // Localhost
        // return approveTxn

        return observeTxn
      } catch (err) {
        if ((err as any).message === 'Could not get balance') {
          throw new Error('No ZIL to pay for transaction.')
        } else {
          throw err
        }
      }
    }

    return null
  }

  /**
   * Calculates the amount of tokens to be sent in (sold) for an exact amount of tokens to be received (bought) at the current instance.
   * 
   * This value returned from this method only applies for the reserve level in the Zilswap-V2 Pool contract at the current instance. 
   * Pool reserves might change in between the time that this method is called, and the time that the swap occurs. 
   * Additonal slippage will need to be taken into consideration when calling the Swap transitions.
   *
   * The exact amount of tokens to be received (bought) is `amountOutStr`. 
   * The SDK determines the path that returns the least token input and returns the input amount.
   * 
   * This method works even if the token to be received (bought) is ZIL. Note that if the token to be received is ZIL, 
   * the tokenOutID should be that of wZIL.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param tokenInID is the token ID to be sent to pool (sold), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param tokenOutID is the token ID to be taken from pool (bought), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountOutStr is the exact amount of tokens to receive from the pool as a unitless string (integer, no decimals).
   */
  public getInputForExactOutput(
    tokenInID: string,
    tokenOutID: string,
    amountOutStr: string,
  ): string | null {
    const tokenInHash = this.getHash(tokenInID)
    const tokenOutHash = this.getHash(tokenOutID)

    if (!(this.getAppState().tokens[tokenInHash] && this.getAppState().tokens[tokenOutHash])) {
      throw new Error("Token Pair does not exist")
    }
    if (tokenInHash === tokenOutHash) {
      throw new Error("Invalid Token Pair")
    }

    const amountOut = unitlessBigNumber(amountOutStr)
    if (amountOut.lt(0)) { throw new Error("Invalid amountInMax or amountOut") }

    const { swapPath, expectedAmount } = this.findSwapPathOut([], tokenInHash, tokenOutHash, amountOut, 3);

    if (!swapPath?.length) return null;
    return expectedAmount.toString()
  }

  /**
   * Calculates the amount of tokens to be received (bought) for an exact amount of tokens to be sent in (sold) at the current instance.
   *
   * This value returned from this method only applies for the reserve level in the Zilswap-V2 Pool contract at the current instance. 
   * Pool reserves might change in between the time that this method is called, and the time that the swap occurs. 
   * Additonal slippage will need to be taken into consideration when calling the Swap transitions.
   * 
   * The exact amount of tokens to be sent in (sold) is `amountInStr`. 
   * The SDK determines the path that returns the most token output and returns the output amount.
   * 
   * This method works even if the token to be sent in (sold) is ZIL. Note that if the token to be received is ZIL, 
   * the tokenOutID should be that of wZIL.
   * 
   * Note that all amounts should be given without decimals, as a unitless integer.
   *
   * @param tokenInID is the token ID to be sent to pool (sold), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param tokenOutID is the token ID to be taken from pool (bought), which can be given by either hash (0x...) or bech32 address (zil...).
   * @param amountInStr is the exact amount of tokens to add to the pool as a unitless string (integer, no decimals).
   */
  public getOutputForExactInput(
    tokenInID: string,
    tokenOutID: string,
    amountInStr: string,
  ): string | null {

    const tokenInHash = this.getHash(tokenInID)
    const tokenOutHash = this.getHash(tokenOutID)

    if (!(this.getAppState().tokens[tokenInHash] && this.getAppState().tokens[tokenOutHash])) {
      throw new Error("Token Pair does not exist")
    }
    if (tokenInHash === tokenOutHash) {
      throw new Error("Invalid Token Pair")
    }

    const amountIn = unitlessBigNumber(amountInStr)
    if (amountIn.isLessThan(0)) { throw new Error("Invalid amountOutMin or amountIn") }

    const { swapPath, expectedAmount } = this.findSwapPathIn([], tokenInHash, tokenOutHash, amountIn, 3);

    if (!swapPath?.length) return null;
    return expectedAmount.toString()
  }

  private async deployPoolContract(init: Value[]) {
    console.log("Deploying ZilSwapV2Pool...")
    console.log(init)
    const contract = this.zilliqa.contracts.new(POOL_CODE, init)
    const [deployTx, state] = await contract.deployWithoutConfirm(this._txParams, false)

    // Check for txn acceptance
    if (!deployTx.id) {
      throw new Error(JSON.stringify(state.error || 'Failed to get tx id!', null, 2))
    }
    console.info(`Deployment transaction id: ${deployTx.id}`)

    const confirmedTx = await deployTx.confirm(deployTx.id, 50, 1000);

    // Check for txn execution success
    if (!confirmedTx.txParams.receipt!.success) {
      const errors = confirmedTx.txParams.receipt!.errors || {}
      const errMsgs = JSON.stringify(
        Object.keys(errors).reduce((acc, depth) => {
          const errorMsgList = errors[depth].map((num: any) => TransactionError[num])
          return { ...acc, [depth]: errorMsgList }
        }, {}))
      const error = `Failed to deploy contract\n${errMsgs}`
      throw new Error(error)
    }

    // Add to observedTx
    const observeTxn = {
      hash: confirmedTx.id!,
      deadline: this.deadlineBlock(),
    }
    await this.observeTx(observeTxn)

    console.log(`The contract address is: ${state.address!}`)

    const deployedContract = this.getContract(state.address!)
    return deployedContract
  }

  public async callContract(
    contract: Contract,
    transition: string,
    args: Value[],
    params: CallParams,
    toDs?: boolean
  ): Promise<Transaction> {

    console.log(`Calling ${transition}...`)
    console.log(args, params)

    let tx
    if (this.walletProvider) {
      // ugly hack for zilpay provider
      tx = await (contract as any).call(transition, args, params, toDs)
      tx.id = tx.ID
      tx.isRejected = function (this: { errors: any[]; exceptions: any[] }) {
        return this.errors.length > 0 || this.exceptions.length > 0
      }
    } else {
      tx = await contract.callWithoutConfirm(transition, args, params, toDs)
    }

    console.log(`Contract call ${transition} id: ${tx.id}`)

    // // Localhost
    // const receipt = tx.getReceipt()
    // console.log(`${transition} receipt`, receipt)
    // if (receipt && !receipt.success) {
    //   const errors = receipt.errors
    //   if (errors) {
    //     const errMsgs = Object.keys(errors).reduce((acc, depth) => {
    //       const errorMsgList = errors[depth].map((num: any) => TransactionError[num])
    //       return { ...acc, [depth]: errorMsgList }
    //     }, {})
    //     console.info(`Contract call for ${transition} failed:\n${JSON.stringify(errMsgs, null, 2)}\n` +
    //       `${receipt.exceptions ? `Exceptions:\n${JSON.stringify(receipt.exceptions, null, 2)}\n` : ''}` +
    //       `Parameters:\n${JSON.stringify(args)}\n`
    //     )
    //   }
    // }
    return tx
  }

  private getTokenPath(poolPath: Pool[], tokenInHash: string) {
    const tokenPath = poolPath.reduce((accum, pool) => {
      const [prevPair] = accum.slice(-1)
      const { token0, token1 } = pool.contractState;

      let [tokenIn, tokenOut] = [token0, token1];

      // reverse token pairs if 
      if (!prevPair && token1 === tokenInHash) {
        // is first pair and token1 = tokenIn
        [tokenIn, tokenOut] = [token1, token0];

        // or is not first pair, and token1 = previous tokenOut
      } else if (prevPair && token1 === prevPair[1]) {
        [tokenIn, tokenOut] = [token1, token0];
      }

      accum.push([tokenIn, tokenOut])

      return accum;
    }, [] as [string, string][]);

    return tokenPath;
  }

  public findSwapPathIn(swapPath: [Pool, boolean][], tokenInHash: string, tokenOutHash: string, tokenAmountIn: BigNumber, poolStepsLeft: number): { swapPath: [Pool, boolean][] | null, expectedAmount: BigNumber } {
    const { pools } = this.getAppState();
    const poolsPath = swapPath.map(s => s[0]);

    const optionPools = Object.values(pools).filter((pool) => {
      if (poolsPath.includes(pool)) return false;
      return pool.contractState.token0 === tokenInHash || pool.contractState.token1 === tokenInHash
    });
    let bestAmount = BN_ZERO;
    let bestPath: [Pool, boolean][] | null = null;
    for (const pool of optionPools) {
      const isSameOrder = pool.contractState.token0 === tokenInHash;
      const newPath = swapPath.concat([[pool, isSameOrder]]);
      const [poolTokenIn, poolTokenOut] = isSameOrder ? [pool.contractState.token0, pool.contractState.token1] : [pool.contractState.token1, pool.contractState.token0];
      const foundEndPool = poolTokenOut === tokenOutHash;

      if (!foundEndPool && poolStepsLeft - 1 <= 0) {
        continue;
      }

      const expAmount = this.getAmountOut(tokenAmountIn, pool, poolTokenIn);

      if (foundEndPool) {
        if (expAmount.gt(bestAmount)) {
          bestPath = newPath;
          bestAmount = expAmount;
        }
      } else {
        const { swapPath, expectedAmount } = this.findSwapPathIn(newPath, poolTokenOut, tokenOutHash, expAmount, poolStepsLeft - 1);
        if (swapPath && expectedAmount.gt(bestAmount)) {
          bestPath = swapPath;
          bestAmount = expectedAmount;
        }
      }
    }

    console.log("xx path", bestPath, bestAmount.toString(10))

    return { swapPath: bestPath, expectedAmount: bestAmount };
  }

  public findSwapPathOut(swapPath: [Pool, boolean][], tokenInHash: string, tokenOutHash: string, tokenAmountOut: BigNumber, poolStepsLeft: number): { swapPath: [Pool, boolean][] | null, expectedAmount: BigNumber } {
    const { pools } = this.getAppState();
    const poolsPath = swapPath.map(s => s[0]);

    const optionPools = Object.values(pools).filter((pool) => {
      if (poolsPath.includes(pool)) return false;
      return pool.contractState.token0 === tokenInHash || pool.contractState.token1 === tokenInHash
    });
    let bestAmount = BN_ZERO;
    let bestPath: [Pool, boolean][] | null = null;
    for (const pool of optionPools) {
      const isSameOrder = pool.contractState.token1 === tokenOutHash;
      const newPath: [Pool, boolean][] = [[pool, isSameOrder], ...swapPath];
      const [poolTokenIn, poolTokenOut] = isSameOrder ? [pool.contractState.token0, pool.contractState.token1] : [pool.contractState.token1, pool.contractState.token0];
      const foundStartPool = poolTokenIn !== tokenInHash;

      if (!foundStartPool && poolStepsLeft - 1 <= 0) {
        continue;
      }

      const expAmount = this.getAmountIn(tokenAmountOut, pool, poolTokenIn);

      if (foundStartPool) {
        if (expAmount.lt(bestAmount)) {
          bestPath = newPath;
          bestAmount = expAmount;
        }
        break;
      } else {
        const { swapPath, expectedAmount } = this.findSwapPathOut(newPath, tokenInHash, poolTokenIn, expAmount, poolStepsLeft - 1);
        if (swapPath && expectedAmount.lt(bestAmount)) {
          bestPath = swapPath;
          bestAmount = expectedAmount;
        }
      }
    }

    return { swapPath: bestPath, expectedAmount: bestAmount };
  }

  private async checkAllowance(tokenHash: string, amount: string | BigNumber) {
    // Check init
    this.checkAppLoadedWithUser()
    const user = this.getAppState().currentUser!

    // Check zrc-2 balance
    const requests: BatchRequest[] = []
    const address = tokenHash.replace('0x', '')
    requests.push({
      id: 'allowances',
      method: 'GetSmartContractSubState',
      params: [address, 'allowances', [user!, this.contractHash]],
      jsonrpc: '2.0',
    })
    const result = await sendBatchRequest(this.rpcEndpoint, requests)

    const allowance = new BigNumber(result.allowances?.allowances[user]?.[this.contractHash] || 0)
    if (allowance.lt(amount)) {
      throw new Error(`Tokens need to be approved first.
      Required: ${this.toUnit(tokenHash, amount.toString()).toString()},
      approved: ${this.toUnit(tokenHash, allowance.toString()).toString()}.`)
    }
  }

  private async checkBalance(tokenHash: string, amount: string | BigNumber) {
    // Check init
    this.checkAppLoadedWithUser()
    const user = this.getAppState().currentUser!

    // Check zrc-2 balance
    if (tokenHash === ZIL_HASH) {
      // Check zil balance
      const zilBalance = this.getAppState().currentZILBalance!
      if (zilBalance.lt(amount)) {
        throw new Error(`Insufficent ZIL in wallet.
        Required: ${this.toUnit(tokenHash, amount.toString()).toString()},
        have: ${this.toUnit(tokenHash, zilBalance.toString()).toString()}.`)
      }
    }
    else {
      const requests: BatchRequest[] = []
      const address = tokenHash.replace('0x', '')
      requests.push({ id: 'balances', method: 'GetSmartContractSubState', params: [address, 'balances', [user!]], jsonrpc: '2.0' })
      const result = await sendBatchRequest(this.rpcEndpoint, requests)
      const balance = new BigNumber(result.balances?.balances[user] || 0)
      if (balance.lt(amount)) {
        throw new Error(`Insufficent tokens in wallet.
        Required: ${(this.toUnit(tokenHash, amount.toString())).toString()},
        have: ${this.toUnit(tokenHash, balance.toString()).toString()}.`)
      }
    }
  }

  /**
  * Gets the contract with the given address that can be called by the default account.
  */
  public getContract(address: string): Contract {
    return (this.walletProvider || this.zilliqa).contracts.at(address)
  }

  /**
   * Converts an amount to it's human representation (with decimals based on token contract, or 12 decimals for ZIL)
   * from it's unitless representation (integer, no decimals).
   * @param tokenID is the token ID related to the conversion amount, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param amountStr is the unitless amount as a string (e.g. 42000000000000 for 42 ZILs) to be converted.
   */
  public toUnit(tokenID: string, amountStr: string): string {
    const tokenDetails = this.getTokenDetails(tokenID)
    const amountBN = new BigNumber(amountStr)
    if (!amountBN.integerValue().isEqualTo(amountStr)) {
      throw new Error(`Amount ${amountStr} for ${tokenDetails.symbol} cannot have decimals.`)
    }
    return amountBN.shiftedBy(-tokenDetails.decimals).toString()
  }

  /**
   * Converts an amount to it's unitless representation (integer, no decimals) from it's
   * human representation (with decimals based on token contract, or 12 decimals for ZIL).
   * @param tokenID is the token ID related to the conversion amount, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param amountHuman is the amount as a human string (e.g. 4.2 for 4.2 ZILs) to be converted.
   */
  public toUnitless(tokenID: string, amountHuman: string): string {
    const token = this.getTokenDetails(tokenID)
    const amountUnitless = new BigNumber(amountHuman).shiftedBy(token.decimals)
    if (!amountUnitless.integerValue().isEqualTo(amountUnitless)) {
      throw new Error(`Amount ${amountHuman} for ${token.symbol} has too many decimals, max is ${token.decimals}.`)
    }
    return amountUnitless.toString()
  }

  public async fetchContractInit(contract: Contract): Promise<any> {
    // try to use cache first
    const lsCacheKey = `contractInit:${contract.address!}`
    if (isLocalStorageAvailable()) {
      const result = localStorage.getItem(lsCacheKey)
      if (result && result !== '') {
        try {
          return JSON.parse(result)
        } catch (e) {
          console.error(e)
        }
      }
    }
    // motivation: workaround api.zilliqa.com intermittent connection issues.
    try {
      // some wallet providers throw an uncaught error when address is non-contract
      const init = await new Zilliqa(this.rpcEndpoint).contracts.at(contract.address!).getInit()
      if (init === undefined) throw new Error(`Could not retrieve contract init params ${contract.address}`)

      if (isLocalStorageAvailable()) {
        localStorage.setItem(lsCacheKey, JSON.stringify(init))
      }
      return init
    } catch (err) {
      if ((err as any).message === 'Network request failed') {
        // make another fetch attempt after 800ms
        return this.fetchContractInit(contract)
      } else {
        throw err
      }
    }
  }

  private async fetchTokenDetails(hash: string): Promise<TokenDetails> {
    if (!!this.appState?.tokens[hash]) return this.appState.tokens[hash]!

    const contract = this.getContract(hash)
    const address = toBech32Address(hash)

    const init = await this.fetchContractInit(contract)

    const decimalStr = init.find((e: Value) => e.vname === 'decimals').value as string
    const decimals = parseInt(decimalStr, 10)
    const name = init.find((e: Value) => e.vname === 'name').value as string
    const symbol = init.find((e: Value) => e.vname === 'symbol').value as string

    return { contract, address, hash, name, symbol, decimals }
  }

  private getTokenDetails(hash: string): TokenDetails {
    if (!this.getAppState().tokens) {
      throw new Error('App state not loaded, call #initialize first.')
    }
    if (!this.getAppState().tokens[hash]) {
      throw new Error(`Could not find token details for ${hash}`)
    }
    return this.getAppState().tokens[hash]!
  }

  private getHash(addressOrHash: string): string {
    if (addressOrHash.substring(0, 2) === '0x') {
      return addressOrHash.toLowerCase()
    }
    else if (addressOrHash.length === 32) {
      return `0x${addressOrHash}`.toLowerCase()
    }
    else if (addressOrHash.substring(0, 3) === 'zil') {
      return fromBech32Address(addressOrHash).toLowerCase()
    }
    else {
      throw new Error('Invalid recipient address format!')
    }
  }

  private quote(amountA: string | number | BigNumber, reserveA: string | number | BigNumber, reserveB: string | number | BigNumber): BigNumber {
    return this.frac(amountA, reserveB, reserveA)
  }

  private getTradeInfo(pool: Pool, tokenIn: string) {
    const isNoAmp = pool.ampBps.eq(ONE_IN_BPS);
    return tokenIn === pool.contractState.token0 ? {
      reserveIn: isNoAmp ? pool.token0Reserve : pool.token0vReserve,
      reserveOut: isNoAmp ? pool.token1Reserve : pool.token1vReserve,
    } : {
      reserveIn: isNoAmp ? pool.token1Reserve : pool.token1vReserve,
      reserveOut: isNoAmp ? pool.token0Reserve : pool.token0vReserve,
    };
  }

  private getEma(ema: string | number | BigNumber, alpha: string | number | BigNumber, value: string | number | BigNumber) {
    // return ((precision - alpha) * ema + alpha * value) / precision; 
    const a = new BigNumber(PRECISION).minus(alpha).multipliedBy(ema)
    const b = new BigNumber(alpha).multipliedBy(value)
    return (a.plus(b)).dividedToIntegerBy(PRECISION)
  }

  private getRFactor(pool: Pool) {
    const currentBlock = new BigNumber(this.getCurrentBlock())

    const oldShortEMA = new BigNumber(pool.contractState.short_ema)
    const oldLongEMA = new BigNumber(pool.contractState.long_ema)
    const currentBlockVolume = new BigNumber(pool.contractState.current_block_volume)
    const lastTradeBlock = new BigNumber(pool.contractState.last_trade_block).isZero() ? currentBlock : new BigNumber(pool.contractState.last_trade_block)

    const skipBlock = currentBlock.minus(lastTradeBlock)

    if (skipBlock.isZero()) {
      return this.calculateRFactor(oldShortEMA, oldLongEMA)
    }
    else {
      let newShortEMA, newLongEMA;
      const skipBlockMinusOne = skipBlock.minus(1)

      newShortEMA = this.getEma(oldShortEMA, SHORT_ALPHA, currentBlockVolume)
      newShortEMA = this.mulInPrecision(newShortEMA, new BigNumber(PRECISION).minus(SHORT_ALPHA))
      newShortEMA = this.unsafePowInPrecision(newShortEMA, skipBlockMinusOne)

      newLongEMA = this.getEma(oldLongEMA, LONG_ALPHA, currentBlockVolume)
      newLongEMA = this.mulInPrecision(newLongEMA, new BigNumber(PRECISION).minus(LONG_ALPHA))
      newLongEMA = this.unsafePowInPrecision(newLongEMA, skipBlockMinusOne)

      return this.calculateRFactor(newShortEMA, newLongEMA)
    }
  }

  private calculateRFactor(shortEMA: string | number | BigNumber, longEMA: string | number | BigNumber) {
    if (new BigNumber(longEMA).isZero()) {
      return new BigNumber(0)
    }
    else {
      return this.frac(shortEMA, PRECISION, longEMA)
    }
  }

  private getFee(rFactorInPrecision: string | number | BigNumber) {
    const R0 = new BigNumber(1477405064814996100);
    const C2 = new BigNumber(20036905816356657810);
    const C0 = this.frac(60, PRECISION, 10000);
    const A = this.frac(20000, PRECISION, 27);
    const B = this.frac(250, PRECISION, 9);
    const C1 = this.frac(985, PRECISION, 27);
    const U = this.frac(120, PRECISION, 100);
    const G = this.frac(836, PRECISION, 1000);
    const F = new BigNumber(5).multipliedBy(PRECISION);
    const L = this.frac(2, PRECISION, 10000);

    const rFactor = BigNumber.isBigNumber(rFactorInPrecision) ? rFactorInPrecision : new BigNumber(rFactorInPrecision)
    let tmp, tmp2, tmp3

    if (rFactor.gte(R0)) {
      return C0;
    }
    else if (rFactor.gte(PRECISION)) {
      // C1 + A * (r-U)^3 + b * (r -U)
      if (rFactor.gt(U)) {
        tmp = rFactor.minus(U)
        tmp3 = this.unsafePowInPrecision(tmp, 3);
        return (C1.plus(this.mulInPrecision(A, tmp3)).plus(this.mulInPrecision(B, tmp))).dividedToIntegerBy(10000)
      } else {
        tmp = U.minus(rFactor)
        tmp3 = this.unsafePowInPrecision(tmp, 3)
        return (C1.minus(this.mulInPrecision(A, tmp3)).minus(this.mulInPrecision(B, tmp))).dividedToIntegerBy(10000)
      }
    } else {
      // [ C2 + sign(r - G) *  F * (r-G) ^2 / (L + (r-G) ^2) ] / 10000
      tmp = rFactor.gt(G) ? rFactor.minus(G) : G.minus(rFactor)
      tmp = this.unsafePowInPrecision(tmp, 2)
      tmp2 = this.frac(F, tmp, tmp.plus(L))
      if (rFactor.gt(G)) {
        return C2.plus(tmp2).dividedToIntegerBy(10000)
      }
      else {
        return C2.minus(tmp2).dividedToIntegerBy(10000);
      }
    }
  }

  private getFinalFee(feeInPrecision: BigNumber, ampBps: BigNumber) {
    if (ampBps.lte(20000)) {
      return feeInPrecision
    }
    else if (ampBps.lte(50000)) {
      return this.frac(feeInPrecision, 20, 30)
    }
    else if (ampBps.lte(200000)) {
      return this.frac(feeInPrecision, 10, 30)
    }
    else {
      return this.frac(feeInPrecision, 4, 30)
    }
  }

  private unsafePowInPrecision(xInPrecision: string | number | BigNumber, k: string | number | BigNumber) {
    let K = new BigNumber(k)
    let zInPrecision = !(K.mod(2).isZero()) ? new BigNumber(xInPrecision) : new BigNumber(PRECISION)

    for (K = K.dividedToIntegerBy(2); !(K.isZero()); K = K.dividedToIntegerBy(2)) {
      xInPrecision = this.mulInPrecision(xInPrecision, xInPrecision)

      if (!(K.mod(2).isZero())) {
        zInPrecision = this.mulInPrecision(zInPrecision, xInPrecision)
      }
    }
    return zInPrecision
  }

  private frac(x: string | number | BigNumber, y: string | number | BigNumber, z: string | number | BigNumber) {
    // return (x*y)/z
    return new BigNumber(x).multipliedBy(y).dividedToIntegerBy(z)
  }

  private mulInPrecision(x: string | number | BigNumber, y: string | number | BigNumber) {
    // return (x*y)/PRECISION
    return this.frac(x, y, PRECISION)
  }

  private getPool(poolAddress: string) {
    const { pools } = this.getAppState();
    const poolHash = this.getHash(poolAddress);
    const pool = pools[poolHash];

    if (!pool)
      throw new Error("Pool does not exist")
    return pool;
  }

  private getAmountOut(amountIn: BigNumber, pool: Pool, tokenIn: string) {

    const isSameOrder = tokenIn === pool.contractState.token0;

    // Not possible to get any tokens if reserve === 0
    if (isSameOrder && pool.token1Reserve.isZero()) { return new BigNumber(0) }
    else if (!isSameOrder && pool.token0Reserve.isZero()) { return new BigNumber(0) }

    // Calculate feeInPrecision
    const rFactorInPrecision = this.getRFactor(pool)
    const intermediateFee = this.getFee(rFactorInPrecision)
    const feeInPrecision = this.getFinalFee(intermediateFee, pool.ampBps)
    const { reserveIn, reserveOut } = this.getTradeInfo(pool, tokenIn)

    // get_amount_out
    const precisionMinusFee = new BigNumber(PRECISION).minus(feeInPrecision)
    const amountInWithFee = this.frac(amountIn, precisionMinusFee, PRECISION)
    const numerator = amountInWithFee.multipliedBy(reserveOut)
    const denominator = amountInWithFee.plus(reserveIn)
    return numerator.dividedToIntegerBy(denominator)
  }

  public getAmountIn(amountOut: BigNumber, pool: Pool, tokenIn: string) {
    const isSameOrder = tokenIn === pool.contractState.token0;

    // Arbitrarily large number; Not possible to get any tokens if reserve === 0
    if (isSameOrder && pool.token1Reserve.isZero()) { return new BigNumber(100000000000000000000000000000000000000) }
    else if (!isSameOrder && pool.token0Reserve.isZero()) { return new BigNumber(100000000000000000000000000000000000000) }

    // Calculate feeInPrecision
    const rFactorInPrecision = this.getRFactor(pool)
    const intermediateFee = this.getFee(rFactorInPrecision)
    const feeInPrecision = this.getFinalFee(intermediateFee, pool.ampBps)
    const { reserveIn, reserveOut } = this.getTradeInfo(pool, tokenIn)

    // get_amount_in
    let numerator = new BigNumber(reserveIn).multipliedBy(amountOut)
    let denominator = new BigNumber(reserveOut).minus(amountOut)
    let amountIn = numerator.dividedToIntegerBy(denominator).plus(1)
    numerator = amountIn.multipliedBy(PRECISION)
    denominator = new BigNumber(PRECISION).minus(feeInPrecision)
    return numerator.plus(denominator.minus(1)).dividedToIntegerBy(denominator)
  }

  /**
   * Updates the app state based on blockchain info.
   * 
   */
  private async updateAppState(): Promise<void> {
    // Initialize current user
    const currentUser = this.walletProvider
      ? // ugly hack for zilpay provider
      this.walletProvider.wallet.defaultAccount.base16.toLowerCase()
      : this.zilliqa.wallet.defaultAccount?.address?.toLowerCase() || null

    const routerState = await this.fetchRouterState()
    const pools = await this.fetchPoolStates(routerState)
    const tokens = await this.fetchTokens(pools)
    this.appState = { currentUser, tokens, pools, routerState };
  }

  /**
   * Updates the app with the router state based on blockchain info.
   * 
   */
  private async fetchRouterState(): Promise<RouterState> {
    const requests: BatchRequest[] = []
    const address = this.contractHash.replace('0x', '')
    requests.push({ id: '1', method: 'GetSmartContractSubState', params: [address, 'all_pools', []], jsonrpc: '2.0' })

    const result = await sendBatchRequest(this.rpcEndpoint, requests)

    const routerState = Object.values(result).reduce((a, i) => ({ ...a, ...i }), {}) as RouterState
    return routerState;
  }

  /**
   * Updates the app with the state of all pools based on blockchain info.
   * 
   */
  private async fetchPoolStates(routerState: RouterState): Promise<{ [index: string]: Pool }> {
    const allPools = routerState.all_pools

    if (allPools.length === 0) {
      return {};
    }

    const requests = allPools.map((poolHash, index) => ({
      id: index.toString(),
      method: 'GetSmartContractState',
      params: [poolHash.slice(2)],
      jsonrpc: '2.0'
    }));
    const results = await sendBatchRequest(this.rpcEndpoint, requests);

    const pools = allPools.reduce((accum, poolHash, index) => {
      const poolState: PoolState = results[index];
      accum[poolHash] = this.constructPool(poolState, poolHash);
      return accum;
    }, {} as { [index: string]: Pool });

    return pools;
  }

  /**
   * Updates the app with the state of all pools based on blockchain info.
   * 
   */
  private async fetchTokens(pools: { [index: string]: Pool }): Promise<{ [index: string]: TokenDetails }> {
    const tokens: { [index: string]: TokenDetails } = {} // tokenAddress: tokenDetails
    const poolHashes = Object.keys(pools);

    // Obtain an array of token hashes that are used in the pools
    if (poolHashes.length === 0) {
      return tokens;
    }

    const tokenHashes = poolHashes.reduce((hashes, poolHash) => {
      const { token0, token1 } = pools[poolHash].contractState;
      hashes[poolHash] = true;
      hashes[token0] = true;
      hashes[token1] = true;
      return hashes;
    }, {} as { [index: string]: true });

    // Fetch the token details using the token hash
    const promises = Object.keys(tokenHashes).map(async (hash) => {
      try {
        const d = await this.fetchTokenDetails(hash)
        tokens[hash] = d
      } catch (err) {
        if (
          (err as any).message?.startsWith('Could not retrieve contract init params') ||
          (err as any).message?.startsWith('Address not contract address')
        ) {
          return;
        }
        throw err
      }
    })
    await Promise.all(promises)


    return tokens;
  }

  private constructPool(poolState: PoolState, poolHash: string): Pool {
    const token0 = poolState.token0
    const token1 = poolState.token1
    const ampBps = new BigNumber(poolState.amp_bps)

    const token0Reserve = new BigNumber(poolState.reserve0)
    const token1Reserve = new BigNumber(poolState.reserve1)
    const token0vReserve = new BigNumber(poolState.v_reserve0)
    const token1vReserve = new BigNumber(poolState.v_reserve1)
    const exchangeRate = token0Reserve.times(ampBps).dividedBy(token1Reserve) // token0/ token1
    const totalSupply = new BigNumber(poolState.total_supply)

    const pool: Pool = {
      poolAddress: toBech32Address(poolHash),
      poolHash,

      token0Address: toBech32Address(token0),
      token1Address: toBech32Address(token1),
      ampBps,

      token0Reserve,
      token1Reserve,
      token0vReserve,
      token1vReserve,
      exchangeRate,
      totalSupply,

      contractState: poolState,
    };

    return pool;
  }

  private subscribeToAppChanges() {
    // clear existing subscription, if any
    this.subscription?.stop()

    const pools = Object.keys(this.getAppState().pools)
    const subscription = this.zilliqa.subscriptionBuilder.buildEventLogSubscriptions(WSS[this.network], {
      addresses: [this.contractHash, ...pools]
    })

    subscription.subscribe({ query: MessageType.NEW_BLOCK })

    subscription.emitter.on(StatusType.SUBSCRIBE_EVENT_LOG, event => {
      console.log('ws connected: ', event)
    })

    subscription.emitter.on(MessageType.NEW_BLOCK, event => {
      // console.log('new block: ', JSON.stringify(event, null, 2))
      this.updateBlockHeight().then(() => this.updateObservedTxs())
    })

    subscription.emitter.on(MessageType.EVENT_LOG, event => {
      if (!event.value) return
      // console.log('ws update: ', JSON.stringify(event, null, 2))

      for (const item of event.value) {
        const byStr20Address = `0x${item.address}`

        // Update single pool state if event thrown from pool
        if (Object.keys(this.getAppState().pools).includes(byStr20Address)) {
          this.updateSinglePoolState(byStr20Address)
        }

        // Update whole app state when routerState changes
        if (byStr20Address === this.contractHash) {
          for (const event of item.event_logs) {
            this.updateAppState()
          }
        }
      }
    })

    subscription.emitter.on(MessageType.UNSUBSCRIBE, event => {
      console.log('ws disconnected: ', event)
      this.subscription = null
    })

    subscription.start()

    this.subscription = subscription
  }

  private async updateObservedTxs() {
    const release = await this.observerMutex.acquire()
    try {
      const removeTxs: string[] = []
      const promises = this.observedTxs.map(async (observedTx: ObservedTx) => {
        try {
          const result = await this.zilliqa.blockchain.getTransactionStatus(observedTx.hash)

          if (result && result.modificationState === 2) {
            // either confirmed or rejected
            const confirmedTxn = await this.zilliqa.blockchain.getTransaction(observedTx.hash)
            const receipt = confirmedTxn.getReceipt()
            const txStatus = confirmedTxn.isRejected() ? 'rejected' : receipt?.success ? 'confirmed' : 'rejected'
            if (this.observer) this.observer(observedTx, txStatus, receipt)
            removeTxs.push(observedTx.hash)
            return
          }
        } catch (err) {
          if ((err as any).code === -20) {
            // "Txn Hash not Present"
            console.warn(`tx not found in mempool: ${observedTx.hash}`)
          } else {
            console.warn('error fetching tx state')
            console.error(err)
          }
        }
        if (observedTx.deadline < this.currentBlock) {
          // expired
          console.log(`tx exceeded deadline: ${observedTx.deadline}, current: ${this.currentBlock}`)
          if (this.observer) this.observer(observedTx, 'expired')
          removeTxs.push(observedTx.hash)
        }
      })

      await Promise.all(promises)

      this.observedTxs = this.observedTxs.filter((tx: ObservedTx) => !removeTxs.includes(tx.hash))

      await this.updateZILBalanceAndNonce()
    } finally {
      release()
    }
  }

  /**
   * Updates the app with the latest ZIL balance and nonce based on blockchain info.
   * 
   * @param poolHash is the hash of the pool.
   */
  private async updateZILBalanceAndNonce() {
    const appState = this.getAppState();
    if (appState.currentUser) {
      try {
        const res: RPCBalanceResponse = (await this.zilliqa.blockchain.getBalance(appState.currentUser)).result
        if (!res) {
          appState.currentZILBalance = new BigNumber(0)
          appState.currentNonce = 0
          return
        }
        appState.currentZILBalance = new BigNumber(res.balance)
        appState.currentNonce = parseInt(res.nonce, 10)
      } catch (err) {
        // ugly hack for zilpay non-standard API
        if ((err as any).message === 'Account is not created') {
          appState.currentZILBalance = new BigNumber(0)
          appState.currentNonce = 0
        }
      }

    }
    else {
      appState.currentZILBalance = null
      appState.currentNonce = null
    }
  }

  /**
   * Updates the app with the latest state of a specified pool based on blockchain info.
   * Used when the state of a single pool has changed
   * 
   * @param poolHash is the hash of the pool.
   */
  private async updateSinglePoolState(poolHash: string) {
    const appState = this.getAppState();
    if (!appState.pools[poolHash]) {
      throw new Error("Pool does not exist")
    }

    const requests: BatchRequest[] = []
    const address = poolHash.replace('0x', '')
    requests.push({ id: '1', method: 'GetSmartContractState', params: [address], jsonrpc: '2.0' })
    const result = await sendBatchRequest(this.rpcEndpoint, requests)
    const poolState = Object.values(result).reduce((a, i) => ({ ...a, ...i }), {})
    appState.pools[poolHash] = this.constructPool(poolState, poolHash);
  }

  /**
   * Updates the app's `currentBlock` to the blockchain's latest blockcount.
   */
  private async updateBlockHeight(): Promise<void> {
    const response = await this.zilliqa.blockchain.getLatestTxBlock()
    const bNum = parseInt(response.result!.header.BlockNum, 10)
    this.currentBlock = bNum
  }

  /**
   * Checks if the user is logged in.
   */
  public checkAppLoadedWithUser() {
    // Check user address
    if (this.getAppState().currentUser === null) {
      throw new Error('No wallet connected.')
    }
    // Check wallet account
    if (this.walletProvider && this.walletProvider.wallet.defaultAccount.base16.toLowerCase() !== this.getAppState().currentUser) {
      throw new Error('Wallet user has changed, please reconnect.')
    }
    // Check network is correct
    if (this.walletProvider && this.walletProvider.wallet.net.toLowerCase() !== this.network.toLowerCase()) {
      throw new Error('Wallet is connected to wrong network.')
    }
  }

  /**
   * Sets the number of blocks to use as the allowable buffer duration before transactions
   * are considered invalid.
   *
   * When a transaction is signed, the deadline block by adding the buffer blocks to
   * the latest confirmed block height.
   *
   * @param bufferBlocks is the number of blocks to use as buffer for the deadline block.
   */
  public setDeadlineBlocks(bufferBlocks: number) {
    if (bufferBlocks <= 0) {
      throw new Error('Buffer blocks must be greater than 0.')
    }
    this.deadlineBuffer = bufferBlocks
  }

  /**
   * Observes the given transaction until the deadline block.
   *
   * Calls the `OnUpdate` callback given during `initialize` with the updated ObservedTx
   * when a change has been observed.
   *
   * @param observedTx is the txn hash of the txn to observe with the deadline block number.
   */
  public async observeTx(observedTx: ObservedTx) {
    const release = await this.observerMutex.acquire()
    try {
      this.observedTxs.push(observedTx)
    } finally {
      release()
    }
  }

  /**
   * Gets the currently observed transactions.
   */
  public async getObservedTxs(): Promise<ObservedTx[]> {
    const release = await this.observerMutex.acquire()
    try {
      return [...this.observedTxs]
    } finally {
      release()
    }
  }

  /**
   * Gets the routerState, poolStates and tokenPools.
   */
  public getAppState() {
    if (!this.appState) {
      throw new Error('App state not loaded, call #initialize first.')
    }
    return this.appState
  }

  /**
   * Gets the routerState.
   */
  public getRouterState(): RouterState {
    return this.getAppState().routerState
  }

  /**
   * Gets the poolStates.
   */
  public getPools(): { [index: string]: Pool } {
    return this.getAppState().pools
  }

  /**
   * Gets the array of pool tokens and LP tokens
   */
  public getTokens(): { [index: string]: TokenDetails } {
    return this.getAppState().tokens
  }

  /**
   * Stops watching the Zilswap contract state.
   */
  public async teardown() {
    this.subscription?.stop()

    const stopped = new Promise<void>(resolve => {
      const checkSubscription = () => {
        if (this.subscription) {
          setTimeout(checkSubscription, 100)
        } else {
          resolve()
        }
      }
      checkSubscription()
    })
    await stopped
  }

  public txParams(): TxParams & { nonce: number } {
    return {
      nonce: this.nonce(),
      ...this._txParams,
    }
  }

  private nonce(): number {
    // // Localhost
    // return this.currentNonce! + 1
    return this.getAppState().currentNonce! + this.observedTxs.length + 1
  }

  public getCurrentBlock(): number {
    return this.currentBlock
  }

  public deadlineBlock(): number {
    return this.currentBlock + this.deadlineBuffer
  }

  private param = (vname: string, type: string, value: any) => {
    return { vname, type, value };
  }
}
