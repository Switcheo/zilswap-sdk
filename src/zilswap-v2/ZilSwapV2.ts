import { Transaction, TxReceipt as _TxReceipt, Wallet } from '@zilliqa-js/account'
import { CallParams, Contract, Value } from '@zilliqa-js/contract'
import { TransactionError } from '@zilliqa-js/core'
import { fromBech32Address, toBech32Address } from '@zilliqa-js/crypto'
import { BN, Long, units } from '@zilliqa-js/util'
import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Mutex } from 'async-mutex'
import { BigNumber } from 'bignumber.js'
import 'isomorphic-fetch'

import { BatchRequest, sendBatchRequest } from '../batch'
import { APIS, BASIS, CHAIN_VERSIONS, Network, ZILSWAPV2_CONTRACTS, ZIL_HASH } from '../constants'
import { isLocalStorageAvailable, toPositiveQa } from '../utils'
import { compile, LONG_ALPHA, PRECISION, SHORT_ALPHA } from './utils'
export * as Zilo from '../zilo'

BigNumber.config({ EXPONENTIAL_AT: 1e9 }) // never!

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

// Tokens on the Pool contract
export type TokenDetails = {
  contract: Contract // instance
  address: string
  hash: string
  name: string
  symbol: string
  decimals: number
}

// V2 Pool contract
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
  balances: { [key in string]?: string }
  allowances: { [key in string]?: { [key2 in string]?: string } }
}

// V2 Router contract
export type RouterState = {
  pool_codehash: string // hash of pool contract
  all_pools: string[]
  pools: { [key in string]?: { [key2 in string]?: string[] } } // tokenA tokenB poolAddress
  unamplified_pools: { [key in string]?: { [key2 in string]?: string[] } } // tokenA tokenB poolAddress
  fee_configuration: [string, string]
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

  // router contract state: Updates when there are new pools
  private routerState?: RouterState

  // pool state: Updates when there are new pools/ changes in the state of the pool
  // If no pools, poolStates = {}
  private poolStates?: { [key in string]?: PoolState } // poolHash : poolState

  // Mapping of tokens in pools & LP tokens to TokenDetails
  // If no pools, tokens = {}
  private tokens?: { [key in string]?: TokenDetails } // tokenHash : tokenDetails

  // Mapping of tokens to the pools holding the token
  private tokenPools?: { [key in string]?: string[] }

  private currentUser: string | null

  // If currentUser == null, currentNonce == null
  private currentNonce?: number | null

  // User's zil balance
  // If currentUser == null, currentZILBalance == null
  private currentZILBalance?: BigNumber | null

  /* Txn observers */
  private observerMutex: Mutex
  private observedTxs: ObservedTx[] = []

  /* Deadline tracking */
  private deadlineBuffer: number = 3
  private currentBlock: number = -1

  /* Zilswap-V2 Router contract attributes */
  readonly contract: Contract
  readonly contractAddress: string //contract address in bech32
  readonly contractHash: string //contract address in hex

  /* Transaction attributes */
  readonly _txParams: TxParams = {
    version: -1,
    gasPrice: new BN(0),
    gasLimit: Long.fromNumber(80000),
  }

  /**
   * Creates the Zilswap-V2 SDK object. {@linkcode initalize} needs to be called after
   * the object is created to begin watching the blockchain's state.
   *
   * @param network the Network to use, either `TestNet` or `MainNet`.
   * @param walletProviderOrKey a Provider with Wallet or private key string to be used for signing txns.
   * @param options a set of Options that will be used for all txns.
   */
  // remember to remove the contractAddress in constructor params
  constructor(readonly network: Network, walletProviderOrKey?: WalletProvider | string, contractAddress: string | null = null, options?: Options) {

    // Initialize Internals
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

    // Initialize router contract attributes
    this.contractAddress = contractAddress || ZILSWAPV2_CONTRACTS[network]
    this.contract = (this.walletProvider || this.zilliqa).contracts.at(this.contractAddress)
    this.contractHash = fromBech32Address(this.contractAddress).toLowerCase()

    // Initialize current user
    this.currentUser = this.walletProvider
      ? // ugly hack for zilpay provider
      this.walletProvider.wallet.defaultAccount.base16.toLowerCase()
      : this.zilliqa.wallet.defaultAccount?.address?.toLowerCase() || null

    // Initialize txParams
    this._txParams.version = CHAIN_VERSIONS[network]

    if (options) {
      if (options.deadlineBuffer && options.deadlineBuffer > 0) this.deadlineBuffer = options.deadlineBuffer
      if (options.gasPrice && options.gasPrice > 0) this._txParams.gasPrice = toPositiveQa(options.gasPrice, units.Units.Li)
      if (options.gasLimit && options.gasLimit > 0) this._txParams.gasLimit = Long.fromNumber(options.gasLimit)
    }

    this.observerMutex = new Mutex()
  }

  /**
   * Intializes the SDK, fetching a cache of the Zilswap contract state and
   * subscribing to subsequent state changes. You may optionally pass an array
   * of ObservedTx's to subscribe to status changes on any of those txs.
   *
   * @param subscription is the callback function to call when a tx state changes.
   * @param observedTx is the array of txs to observe.
   */
  public async initialize() {

    // Update the txParams using chain information
    // Note: javascript constructors cannot contain async tasks
    if (this._txParams.gasPrice.isZero()) {
      const minGasPrice = await this.zilliqa.blockchain.getMinimumGasPrice()
      if (!minGasPrice.result) throw new Error('Failed to get min gas price.')
      this._txParams.gasPrice = new BN(minGasPrice.result)
    }

    await this.updateAppState()
  }


  /////////////////////// Contract Transition functions //////////////////
  public async deployZilswapV2Pool(token0Address: string, token1Address: string, init_amp_bps: number): Promise<Contract> {
    // Check logged in
    this.checkAppLoadedWithUser()

    const token0Contract: Contract = this.getContract(token0Address)
    const token1Contract: Contract = this.getContract(token1Address)

    const t0State = await this.fetchContractInit(token0Contract)
    const t1State = await this.fetchContractInit(token1Contract)

    const pair = `${t0State.find((i: Value) => i.vname == 'symbol').value}-${t1State.find((i: Value) => i.vname == 'symbol').value}`
    const name = `ZilSwap V2 ${pair} LP Token`
    const symbol = `ZWAPv2LP.${pair}`

    // Load file and contract initialization variables
    const file = `./src/zilswap-v2/contracts/ZilSwapPool.scilla`
    const init = [
      this.param('_scilla_version', 'Uint32', '0'),
      this.param('init_token0', 'ByStr20', `${token0Address}`),
      this.param('init_token1', 'ByStr20', `${token1Address}`),
      this.param('init_factory', 'ByStr20', this.contractHash),
      this.param('init_amp_bps', 'Uint128', `${init_amp_bps}`),
      this.param('contract_owner', 'ByStr20', this.contractHash),
      this.param('name', 'String', `${name}`),
      this.param('symbol', 'String', `${symbol}`),
      this.param('decimals', 'Uint32', '12'),
      this.param('init_supply', 'Uint128', '0'),
    ];

    // Call deployContract
    const pool = await this.deployContract(file, init)

    // Update app state
    await this.updateRouterState()
    await this.updatePoolStates()
    await this.updateTokens()
    await this.updateZILBalanceAndNonce()

    return pool
  }

  // Call AddPool transition on the router
  // To be used together with the DeployPool
  public async addPool(pool: string): Promise<Transaction> {
    // Check logged in
    this.checkAppLoadedWithUser()

    const contract: Contract = this.contract
    const args: any = [
      this.param('pool', 'ByStr20', pool)
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

    // Update relevant app states
    await this.updateRouterState()
    await this.updatePoolStates()
    await this.updateTokens()
    await this.updateZILBalanceAndNonce()
    this.updateTokenPools()

    return addPoolTx
  }

  // reserve_ratio_allowance: in percentage
  // Eg If 5%: input 5
  public async addLiquidity(tokenA: string, tokenB: string, pool: string, amountA_desired: string, amountB_desired: string, amountA_min: string, amountB_min: string, reserve_ratio_allowance: number): Promise<Transaction> {

    const poolState = this.poolStates![pool]
    if (!poolState) {
      throw new Error('Pool does not exist')
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    // Calculate amount of tokens added
    const tokenAReserve = poolState.reserve0
    const tokenBReserve = poolState.reserve1
    let amountA, amountB

    if (tokenAReserve === '0' && tokenBReserve === '0') {
      amountA = amountA_desired
      amountB = amountB_desired
    }
    else {
      const amountBOptimal = this.quote(amountA_desired, tokenAReserve, tokenBReserve)
      if (amountBOptimal.lte(amountB_desired)) {
        amountA = amountA_desired
        amountB = amountBOptimal
      }
      else {
        const amountAOptimal = this.quote(amountB_desired, tokenBReserve, tokenAReserve)
        amountA = amountAOptimal
        amountB = amountB_desired
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(tokenA, amountA)
    await this.checkAllowance(tokenB, amountB)
    await this.checkBalance(tokenA, amountA)
    await this.checkBalance(tokenB, amountB)

    // Generate contract args
    const ampBps = new BigNumber(poolState!.amp_bps)
    const isAmpPool = !ampBps.isEqualTo(BASIS)

    let v_reserve_min, v_reserve_max

    if (tokenAReserve === '0' && tokenBReserve === '0') {
      v_reserve_min = '0'
      v_reserve_max = '0'
    }
    else {
      if (isAmpPool) {
        const q112: any = new BigNumber(2).pow(112)
        const v_reserve_a = parseInt(poolState!.v_reserve0)
        const v_reserve_b = parseInt(poolState!.v_reserve1)

        v_reserve_min = new BigNumber((v_reserve_b / v_reserve_a) * (q112) / ((1 + reserve_ratio_allowance / 100))).toString(10)
        v_reserve_max = new BigNumber((v_reserve_b / v_reserve_a) * (q112) * ((1 + reserve_ratio_allowance / 100))).toString(10)
      }
      else {
        v_reserve_min = '0'
        v_reserve_max = '0'
      }
    }

    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('tokenA', 'ByStr20', tokenA),
      this.param('tokenB', 'ByStr20', tokenB),
      this.param('pool', 'ByStr20', pool),
      this.param('amountA_desired', 'Uint128', amountA_desired),
      this.param('amountB_desired', 'Uint128', amountB_desired),
      this.param('amountA_min', 'Uint128', amountA_min),
      this.param('amountB_min', 'Uint128', amountB_min),
      this.param('v_reserve_ratio_bounds', 'Pair (Uint256) (Uint256)',
        {
          "constructor": "Pair",
          "argtypes": ["Uint256", "Uint256"],
          "arguments": [`${v_reserve_min}`, `${v_reserve_max}`]
        }),
      this.param('deadline_block', 'BNum', `${deadline}`)
    ]
    const params: CallParams = {
      amount: new BN(0),
      ...this.txParams()
    }

    // Call contract
    const addLiquidityTxn = await this.callContract(contract, 'AddLiquidity', args, params, true)
    // console.log("addLiquidityTxn", addLiquidityTxn)

    if (addLiquidityTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: addLiquidityTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    // Update relevant app states
    await this.updateSinglePoolState(pool)
    await this.updateZILBalanceAndNonce()

    return addLiquidityTxn
  }

  // reserve_ratio_allowance: in percentage
  // Eg If 5%: input 5
  public async addLiquidityZIL(token: string, pool: string, amount_token_desired: string, amount_wZIL_desired: string, amount_token_min: string, amount_wZIL_min: string, reserve_ratio_allowance: number) {

    const poolState = this.poolStates![pool]
    if (!poolState) {
      throw new Error('Pool does not exist')
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    // Calculate amount of tokens added
    const tokenAReserve = poolState.reserve0
    const tokenBReserve = poolState.reserve1
    let amountToken, amountWZIL

    if (tokenAReserve === '0' && tokenBReserve === '0') {
      amountToken = amount_token_desired
      amountWZIL = amount_wZIL_desired
    }
    else {
      const amountWZILOptimal = await this.quote(amount_token_desired, tokenAReserve, tokenBReserve)
      if (amountWZILOptimal.lte(amount_wZIL_desired)) {
        amountToken = amount_token_desired
        amountWZIL = amountWZILOptimal
      }
      else {
        const amountTokenOptimal = await this.quote(amount_wZIL_desired, tokenBReserve, tokenAReserve)
        amountToken = amountTokenOptimal
        amountWZIL = amount_wZIL_desired
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(token, amountToken)
    await this.checkBalance(token, amountToken)
    await this.checkBalance(ZIL_HASH, amountWZIL)

    // Generate contract args
    const ampBps = parseInt(poolState!.amp_bps)
    const isAmpPool = !(ampBps === BASIS)

    let v_reserve_min, v_reserve_max

    if (tokenAReserve === '0' && tokenBReserve === '0') {
      v_reserve_min = '0'
      v_reserve_max = '0'
    }
    else {
      if (isAmpPool) {
        const q112: any = new BigNumber(2).pow(112)
        const v_reserve_a = parseInt(poolState!.v_reserve0)
        const v_reserve_b = parseInt(poolState!.v_reserve1)

        v_reserve_min = new BigNumber((v_reserve_b / v_reserve_a) * (q112) / ((1 + reserve_ratio_allowance / 100))).toString(10)
        v_reserve_max = new BigNumber((v_reserve_b / v_reserve_a) * (q112) * ((1 + reserve_ratio_allowance / 100))).toString(10)
      }
      else {
        v_reserve_min = '0'
        v_reserve_max = '0'
      }
    }

    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('token', 'ByStr20', token),
      this.param('pool', 'ByStr20', pool),
      this.param('amount_token_desired', 'Uint128', amount_token_desired),
      this.param('amount_token_min', 'Uint128', amount_token_min),
      this.param('amount_wZIL_min', 'Uint128', amount_wZIL_min),
      this.param('v_reserve_ratio_bounds', 'Pair (Uint256) (Uint256)',
        {
          "constructor": "Pair",
          "argtypes": ["Uint256", "Uint256"],
          "arguments": [`${v_reserve_min}`, `${v_reserve_max}`]
        }),
      this.param('deadline_block', 'BNum', `${deadline}`),
    ]
    const params: CallParams = {
      amount: new BN(amount_wZIL_desired),
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

    // Update relevant app states
    await this.updateSinglePoolState(pool)
    await this.updateZILBalanceAndNonce()

    return addLiquidityZilTxn
  }

  public async removeLiquidity(tokenA: string, tokenB: string, pool: string, liquidity: string, amountA_min: string, amountB_min: string) {

    const poolState = this.poolStates![pool]
    if (!poolState) {
      throw new Error('Pool does not exist')
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    // Check Balance and Allowance
    await this.checkAllowance(pool, liquidity)
    await this.checkBalance(pool, liquidity)

    // Generate contract args
    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('tokenA', 'ByStr20', tokenA),
      this.param('tokenB', 'ByStr20', tokenB),
      this.param('pool', 'ByStr20', pool),
      this.param('liquidity', 'Uint128', liquidity),
      this.param('amountA_min', 'Uint128', amountA_min),
      this.param('amountB_min', 'Uint128', amountB_min),
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

    // Update relevant app states
    await this.updateSinglePoolState(pool)
    await this.updateZILBalanceAndNonce()

    return removeLiquidityTxn
  }

  public async removeLiquidityZIL(token: string, pool: string, liquidity: string, amount_token_min: string, amount_wZIL_min: string) {

    const poolState = this.poolStates![pool]
    if (!poolState) {
      throw new Error('Pool does not exist')
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    // Check Balance and Allowance
    await this.checkAllowance(pool, liquidity)
    await this.checkBalance(pool, liquidity)

    // Generate contract args
    const deadline = this.deadlineBlock()

    const contract: Contract = this.contract
    const args: any = [
      this.param('token', 'ByStr20', token),
      this.param('pool', 'ByStr20', pool),
      this.param('liquidity', 'Uint128', liquidity),
      this.param('amount_token_min', 'Uint128', amount_token_min),
      this.param('amount_wZIL_min', 'Uint128', amount_wZIL_min),
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

    // Update relevant app states
    await this.updateSinglePoolState(pool)
    await this.updateZILBalanceAndNonce()

    return removeLiquidityZilTxn
  }

  public async swapExactTokensForTokens(tokenIn: string, tokenOut: string, amountIn: string, amountOutMin: string) {
    if (!(this.tokens![tokenIn] && this.tokens![tokenOut])) {
      throw new Error("Token Pair does not exist")
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    let amountOut: BigNumber = new BigNumber(amountOutMin)
    let poolPath: string[] = []
    let tokenPath: TokenPath[] = []
    let pool1AmtOut: BigNumber;
    let pool2AmtOut: BigNumber;
    let pool3AmtOut: BigNumber;

    for (let i = 0; i < this.tokenPools![tokenIn]!.length; i++) {
      let pool1 = this.tokenPools![tokenIn]![i]
      let pool1TokenOut = this.getOtherToken(pool1, tokenIn)
      pool1AmtOut = await this.getAmountOut(amountIn, pool1, tokenIn)

      // First pool has the desired token pair && amountOutTemp > amountOut
      if (tokenOut === pool1TokenOut && pool1AmtOut.gt(amountOut)) {
        console.log("pool1AmtOut", pool1AmtOut.toString())
        amountOut = pool1AmtOut
        poolPath = [pool1]
        tokenPath = [{ tokenIn, tokenOut }]
        continue;
      }

      for (let j = 0; j < this.tokenPools![pool1TokenOut]!.length; j++) {
        let pool2 = this.tokenPools![pool1TokenOut]![j]
        let pool2TokenOut = this.getOtherToken(pool2, pool1TokenOut)
        pool2AmtOut = await this.getAmountOut(pool1AmtOut, pool2, pool1TokenOut)

        // Second pool has the desired token pair && current amountOut > previous amountOut
        if (tokenOut === pool2TokenOut && pool2AmtOut.gt(amountOut)) {
          console.log("pool2AmtOut", pool2AmtOut.toString())
          amountOut = pool2AmtOut
          poolPath = [pool1, pool2]
          tokenPath = [
            { tokenIn, tokenOut: pool1TokenOut },
            { tokenIn: pool1TokenOut, tokenOut }
          ]
          continue;
        }

        for (let k = 0; k < this.tokenPools![pool2TokenOut]!.length; k++) {
          let pool3 = this.tokenPools![pool2TokenOut]![k]
          let pool3TokenOut = this.getOtherToken(pool3, pool2TokenOut)

          // Second pool has the desired token pair && current amountOut > previous amountOut
          if (tokenOut === pool3TokenOut) {
            pool3AmtOut = await this.getAmountOut(pool2AmtOut, pool3, pool2TokenOut)

            if (pool3AmtOut.gt(amountOut)) {
              console.log("pool3AmtOut", pool3AmtOut.toString())
              amountOut = pool3AmtOut
              poolPath = [pool1, pool2, pool3]
              tokenPath = [
                { tokenIn, tokenOut: pool1TokenOut },
                { tokenIn: pool1TokenOut, tokenOut: pool2TokenOut },
                { tokenIn: pool2TokenOut, tokenOut }
              ]
              continue;
            }
          }
        }
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(tokenIn, amountIn)
    await this.checkBalance(tokenIn, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (poolPath.length === 1) {
      txn = {
        transition: "SwapExactTokensForTokensOnce",
        args: [
          this.param('amount_in', 'Uint128', `${amountIn}`),
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool', 'ByStr20', poolPath[0]),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 2) {
      txn = {
        transition: "SwapExactTokensForTokensTwice",
        args: [
          this.param('amount_in', 'Uint128', `${amountIn}`),
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 3) {
      txn = {
        transition: "SwapExactTokensForTokensThrice",
        args: [
          this.param('amount_in', 'Uint128', `${amountIn}`),
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('pool3', 'ByStr20', poolPath[2]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('path3', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[2].tokenIn}`, `${tokenPath[2].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("There is no pool with the desired token pair")
    }

    const swapExactTokensForTokensTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapExactTokensForTokensTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    // Update relevant app states
    poolPath.map(async (pool) => {
      await this.updateSinglePoolState(pool)
    })
    await this.updateZILBalanceAndNonce()

    return swapExactTokensForTokensTxn
  }

  public async swapTokensForExactTokens(tokenIn: string, tokenOut: string, amountInMax: string, amountOut: string) {
    if (!(this.tokens![tokenIn] && this.tokens![tokenOut])) {
      throw new Error("Token Pair does not exist")
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    let amountIn: BigNumber = new BigNumber(amountInMax)
    let poolPath: string[] = []
    let tokenPath: TokenPath[] = []
    let pool1AmtIn: BigNumber;
    let pool2AmtIn: BigNumber;
    let pool3AmtIn: BigNumber;

    for (let i = 0; i < this.tokenPools![tokenOut]!.length; i++) {
      let pool3 = this.tokenPools![tokenOut]![i]
      let pool3TokenIn = this.getOtherToken(pool3, tokenOut)
      pool3AmtIn = await this.getAmountIn(amountOut, pool3, pool3TokenIn)

      // First pool has the desired token pair && amountOutTemp > amountOut
      if (tokenIn === pool3TokenIn && pool3AmtIn.lt(amountIn)) {
        console.log("pool3AmtIn", pool3AmtIn.toString())
        amountIn = pool3AmtIn
        poolPath = [pool3]
        tokenPath = [{ tokenIn, tokenOut }]
        continue;
      }

      for (let j = 0; j < this.tokenPools![pool3TokenIn]!.length; j++) {
        let pool2 = this.tokenPools![pool3TokenIn]![j]
        let pool2TokenIn = this.getOtherToken(pool2, pool3TokenIn)
        pool2AmtIn = await this.getAmountIn(pool3AmtIn, pool2, pool2TokenIn)

        // Second pool has the desired token pair && current amountOut > previous amountOut
        if (tokenIn === pool2TokenIn && pool2AmtIn.lt(amountIn)) {
          console.log("pool2AmtIn", pool2AmtIn.toString())
          amountIn = pool2AmtIn
          poolPath = [pool2, pool3]
          tokenPath = [
            { tokenIn, tokenOut: pool3TokenIn },
            { tokenIn: pool3TokenIn, tokenOut }
          ]
          continue;
        }

        for (let k = 0; k < this.tokenPools![pool2TokenIn]!.length; k++) {
          let pool1 = this.tokenPools![pool2TokenIn]![k]
          let pool1TokenIn = this.getOtherToken(pool1, pool2TokenIn)

          // Second pool has the desired token pair && current amountOut > previous amountOut
          if (tokenIn === pool1TokenIn) {
            pool1AmtIn = await this.getAmountIn(pool2AmtIn, pool1, pool1TokenIn)

            if (pool1AmtIn.lt(amountOut)) {
              console.log("pool1AmtIn", pool1AmtIn.toString())
              amountIn = pool1AmtIn
              poolPath = [pool1, pool2, pool3]
              tokenPath = [
                { tokenIn, tokenOut: pool2TokenIn },
                { tokenIn: pool2TokenIn, tokenOut: pool3TokenIn },
                { tokenIn: pool3TokenIn, tokenOut }
              ]
              continue;
            }
          }
        }
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(tokenIn, amountIn)
    await this.checkBalance(tokenIn, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (poolPath.length === 1) {
      txn = {
        transition: "SwapTokensForExactTokensOnce",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('amount_in_max', 'Uint128', `${amountInMax}`),
          this.param('pool', 'ByStr20', poolPath[0]),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 2) {
      txn = {
        transition: "SwapTokensForExactTokensTwice",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('amount_in_max', 'Uint128', `${amountInMax}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 3) {
      txn = {
        transition: "SwapTokensForExactTokensThrice",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('amount_in_max', 'Uint128', `${amountInMax}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('pool3', 'ByStr20', poolPath[2]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('path3', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[2].tokenIn}`, `${tokenPath[2].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("There is no pool with the desired token pair")
    }

    const swapTokensForExactTokensTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapTokensForExactTokensTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    // Update relevant app states
    for (var pool of poolPath) {
      await this.updateSinglePoolState(pool)
    }
    await this.updateZILBalanceAndNonce()

    return swapTokensForExactTokensTxn
  }

  // tokenIn: wZIL address
  public async swapExactZILForTokens(tokenIn: string, tokenOut: string, amountIn: string, amountOutMin: string) {
    if (!(this.tokens![tokenIn] && this.tokens![tokenOut])) {
      throw new Error("Token Pair does not exist")
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    let amountOut: BigNumber = new BigNumber(amountOutMin)
    let poolPath: string[] = []
    let tokenPath: TokenPath[] = []
    let pool1AmtOut: BigNumber;
    let pool2AmtOut: BigNumber;
    let pool3AmtOut: BigNumber;

    for (let i = 0; i < this.tokenPools![tokenIn]!.length; i++) {
      let pool1 = this.tokenPools![tokenIn]![i]
      let pool1TokenOut = this.getOtherToken(pool1, tokenIn)
      pool1AmtOut = await this.getAmountOut(amountIn, pool1, tokenIn)

      // First pool has the desired token pair && amountOutTemp > amountOut
      if (tokenOut === pool1TokenOut && pool1AmtOut.gt(amountOut)) {
        console.log("pool1AmtOut", pool1AmtOut.toString())
        amountOut = pool1AmtOut
        poolPath = [pool1]
        tokenPath = [{ tokenIn, tokenOut }]
        continue;
      }

      for (let j = 0; j < this.tokenPools![pool1TokenOut]!.length; j++) {
        let pool2 = this.tokenPools![pool1TokenOut]![j]
        let pool2TokenOut = this.getOtherToken(pool2, pool1TokenOut)
        pool2AmtOut = await this.getAmountOut(pool1AmtOut, pool2, pool1TokenOut)

        // Second pool has the desired token pair && current amountOut > previous amountOut
        if (tokenOut === pool2TokenOut && pool2AmtOut.gt(amountOut)) {
          console.log("pool2AmtOut", pool2AmtOut.toString())
          amountOut = pool2AmtOut
          poolPath = [pool1, pool2]
          tokenPath = [
            { tokenIn, tokenOut: pool1TokenOut },
            { tokenIn: pool1TokenOut, tokenOut }
          ]
          continue;
        }

        for (let k = 0; k < this.tokenPools![pool2TokenOut]!.length; k++) {
          let pool3 = this.tokenPools![pool2TokenOut]![k]
          let pool3TokenOut = this.getOtherToken(pool3, pool2TokenOut)

          // Second pool has the desired token pair && current amountOut > previous amountOut
          if (tokenOut === pool3TokenOut) {
            pool3AmtOut = await this.getAmountOut(pool2AmtOut, pool3, pool2TokenOut)

            if (pool3AmtOut.gt(amountOut)) {
              console.log("pool3AmtOut", pool3AmtOut.toString())
              amountOut = pool3AmtOut
              poolPath = [pool1, pool2, pool3]
              tokenPath = [
                { tokenIn, tokenOut: pool1TokenOut },
                { tokenIn: pool1TokenOut, tokenOut: pool2TokenOut },
                { tokenIn: pool2TokenOut, tokenOut }
              ]
              continue;
            }
          }
        }
      }
    }

    // Check Balance
    await this.checkBalance(ZIL_HASH, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (poolPath.length === 1) {
      txn = {
        transition: "SwapExactZILForTokensOnce",
        args: [
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool', 'ByStr20', poolPath[0]),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 2) {
      txn = {
        transition: "SwapExactZILForTokensTwice",
        args: [
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 3) {
      txn = {
        transition: "SwapExactZILForTokensThrice",
        args: [
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('pool3', 'ByStr20', poolPath[2]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('path3', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[2].tokenIn}`, `${tokenPath[2].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("There is no pool with the desired token pair")
    }

    const swapExactZILForTokensTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapExactZILForTokensTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    // Update relevant app states
    poolPath.map(async (pool) => {
      await this.updateSinglePoolState(pool)
    })
    await this.updateZILBalanceAndNonce()

    return swapExactZILForTokensTxn
  }

  // tokenIn: wZIL address
  public async swapZILForExactTokens(tokenIn: string, tokenOut: string, amountInMax: string, amountOut: string) {
    if (!(this.tokens![tokenIn] && this.tokens![tokenOut])) {
      throw new Error("Token Pair does not exist")
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    let amountIn: BigNumber = new BigNumber(amountInMax)
    let poolPath: string[] = []
    let tokenPath: TokenPath[] = []
    let pool1AmtIn: BigNumber;
    let pool2AmtIn: BigNumber;
    let pool3AmtIn: BigNumber;

    for (let i = 0; i < this.tokenPools![tokenOut]!.length; i++) {
      let pool3 = this.tokenPools![tokenOut]![i]
      let pool3TokenIn = this.getOtherToken(pool3, tokenOut)
      pool3AmtIn = await this.getAmountIn(amountOut, pool3, pool3TokenIn)

      // First pool has the desired token pair && amountOutTemp > amountOut
      if (tokenIn === pool3TokenIn && pool3AmtIn.lt(amountIn)) {
        console.log("pool3AmtIn", pool3AmtIn.toString())
        amountIn = pool3AmtIn
        poolPath = [pool3]
        tokenPath = [{ tokenIn, tokenOut }]
        continue;
      }

      for (let j = 0; j < this.tokenPools![pool3TokenIn]!.length; j++) {
        let pool2 = this.tokenPools![pool3TokenIn]![j]
        let pool2TokenIn = this.getOtherToken(pool2, pool3TokenIn)
        pool2AmtIn = await this.getAmountIn(pool3AmtIn, pool2, pool2TokenIn)

        // Second pool has the desired token pair && current amountOut > previous amountOut
        if (tokenIn === pool2TokenIn && pool2AmtIn.lt(amountIn)) {
          console.log("pool2AmtIn", pool2AmtIn.toString())
          amountIn = pool2AmtIn
          poolPath = [pool2, pool3]
          tokenPath = [
            { tokenIn, tokenOut: pool3TokenIn },
            { tokenIn: pool3TokenIn, tokenOut }
          ]
          continue;
        }

        for (let k = 0; k < this.tokenPools![pool2TokenIn]!.length; k++) {
          let pool1 = this.tokenPools![pool2TokenIn]![k]
          let pool1TokenIn = this.getOtherToken(pool1, pool2TokenIn)

          // Second pool has the desired token pair && current amountOut > previous amountOut
          if (tokenIn === pool1TokenIn) {
            pool1AmtIn = await this.getAmountIn(pool2AmtIn, pool1, pool1TokenIn)

            if (pool1AmtIn.lt(amountOut)) {
              console.log("pool1AmtIn", pool1AmtIn.toString())
              amountIn = pool1AmtIn
              poolPath = [pool1, pool2, pool3]
              tokenPath = [
                { tokenIn, tokenOut: pool2TokenIn },
                { tokenIn: pool2TokenIn, tokenOut: pool3TokenIn },
                { tokenIn: pool3TokenIn, tokenOut }
              ]
              continue;
            }
          }
        }
      }
    }

    // Check Balance and Allowance
    await this.checkBalance(ZIL_HASH, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (poolPath.length === 1) {
      txn = {
        transition: "SwapZILForExactTokensOnce",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('pool', 'ByStr20', poolPath[0]),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn.toString()),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 2) {
      txn = {
        transition: "SwapZILForExactTokensTwice",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn.toString()),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 3) {
      txn = {
        transition: "SwapZILForExactTokensThrice",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('pool3', 'ByStr20', poolPath[2]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('path3', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[2].tokenIn}`, `${tokenPath[2].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(amountIn.toString()),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("There is no pool with the desired token pair")
    }

    const swapZILForExactTokensTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapZILForExactTokensTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    // Update relevant app states
    for (var pool of poolPath) {
      await this.updateSinglePoolState(pool)
    }
    await this.updateZILBalanceAndNonce()

    return swapZILForExactTokensTxn
  }

  // tokenOut: wZIL address
  public async swapExactTokensForZIL(tokenIn: string, tokenOut: string, amountIn: string, amountOutMin: string) {
    if (!(this.tokens![tokenIn] && this.tokens![tokenOut])) {
      throw new Error("Token Pair does not exist")
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    let amountOut: BigNumber = new BigNumber(amountOutMin)
    let poolPath: string[] = []
    let tokenPath: TokenPath[] = []
    let pool1AmtOut: BigNumber;
    let pool2AmtOut: BigNumber;
    let pool3AmtOut: BigNumber;

    for (let i = 0; i < this.tokenPools![tokenIn]!.length; i++) {
      let pool1 = this.tokenPools![tokenIn]![i]
      let pool1TokenOut = this.getOtherToken(pool1, tokenIn)
      pool1AmtOut = await this.getAmountOut(amountIn, pool1, tokenIn)

      // First pool has the desired token pair && amountOutTemp > amountOut
      if (tokenOut === pool1TokenOut && pool1AmtOut.gt(amountOut)) {
        console.log("pool1AmtOut", pool1AmtOut.toString())
        amountOut = pool1AmtOut
        poolPath = [pool1]
        tokenPath = [{ tokenIn, tokenOut }]
        continue;
      }

      for (let j = 0; j < this.tokenPools![pool1TokenOut]!.length; j++) {
        let pool2 = this.tokenPools![pool1TokenOut]![j]
        let pool2TokenOut = this.getOtherToken(pool2, pool1TokenOut)
        pool2AmtOut = await this.getAmountOut(pool1AmtOut, pool2, pool1TokenOut)

        // Second pool has the desired token pair && current amountOut > previous amountOut
        if (tokenOut === pool2TokenOut && pool2AmtOut.gt(amountOut)) {
          console.log("pool2AmtOut", pool2AmtOut.toString())
          amountOut = pool2AmtOut
          poolPath = [pool1, pool2]
          tokenPath = [
            { tokenIn, tokenOut: pool1TokenOut },
            { tokenIn: pool1TokenOut, tokenOut }
          ]
          continue;
        }

        for (let k = 0; k < this.tokenPools![pool2TokenOut]!.length; k++) {
          let pool3 = this.tokenPools![pool2TokenOut]![k]
          let pool3TokenOut = this.getOtherToken(pool3, pool2TokenOut)

          // Second pool has the desired token pair && current amountOut > previous amountOut
          if (tokenOut === pool3TokenOut) {
            pool3AmtOut = await this.getAmountOut(pool2AmtOut, pool3, pool2TokenOut)

            if (pool3AmtOut.gt(amountOut)) {
              console.log("pool3AmtOut", pool3AmtOut.toString())
              amountOut = pool3AmtOut
              poolPath = [pool1, pool2, pool3]
              tokenPath = [
                { tokenIn, tokenOut: pool1TokenOut },
                { tokenIn: pool1TokenOut, tokenOut: pool2TokenOut },
                { tokenIn: pool2TokenOut, tokenOut }
              ]
              continue;
            }
          }
        }
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(tokenIn, amountIn)
    await this.checkBalance(tokenIn, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (poolPath.length === 1) {
      txn = {
        transition: "SwapExactTokensForZILOnce",
        args: [
          this.param('amount_in', 'Uint128', `${amountIn}`),
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool', 'ByStr20', poolPath[0]),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 2) {
      txn = {
        transition: "SwapExactTokensForZILTwice",
        args: [
          this.param('amount_in', 'Uint128', `${amountIn}`),
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 3) {
      txn = {
        transition: "SwapExactTokensForZILThrice",
        args: [
          this.param('amount_in', 'Uint128', `${amountIn}`),
          this.param('amount_out_min', 'Uint128', `${amountOutMin}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('pool3', 'ByStr20', poolPath[2]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('path3', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[2].tokenIn}`, `${tokenPath[2].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("There is no pool with the desired token pair")
    }

    const swapExactTokensForZILTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapExactTokensForZILTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    // Update relevant app states
    poolPath.map(async (pool) => {
      await this.updateSinglePoolState(pool)
    })
    await this.updateZILBalanceAndNonce()

    return swapExactTokensForZILTxn
  }

  // tokenOut: wZIL address
  public async swapTokensForExactZIL(tokenIn: string, tokenOut: string, amountInMax: string, amountOut: string) {
    if (!(this.tokens![tokenIn] && this.tokens![tokenOut])) {
      throw new Error("Token Pair does not exist")
    }

    // Check logged in
    this.checkAppLoadedWithUser()

    // Update blockHeight
    await this.updateBlockHeight()

    let amountIn: BigNumber = new BigNumber(amountInMax)
    let poolPath: string[] = []
    let tokenPath: TokenPath[] = []
    let pool1AmtIn: BigNumber;
    let pool2AmtIn: BigNumber;
    let pool3AmtIn: BigNumber;

    for (let i = 0; i < this.tokenPools![tokenOut]!.length; i++) {
      let pool3 = this.tokenPools![tokenOut]![i]
      let pool3TokenIn = this.getOtherToken(pool3, tokenOut)
      pool3AmtIn = await this.getAmountIn(amountOut, pool3, pool3TokenIn)

      // First pool has the desired token pair && amountOutTemp > amountOut
      if (tokenIn === pool3TokenIn && pool3AmtIn.lt(amountIn)) {
        console.log("pool3AmtIn", pool3AmtIn.toString())
        amountIn = pool3AmtIn
        poolPath = [pool3]
        tokenPath = [{ tokenIn, tokenOut }]
        continue;
      }

      for (let j = 0; j < this.tokenPools![pool3TokenIn]!.length; j++) {
        let pool2 = this.tokenPools![pool3TokenIn]![j]
        let pool2TokenIn = this.getOtherToken(pool2, pool3TokenIn)
        pool2AmtIn = await this.getAmountIn(pool3AmtIn, pool2, pool2TokenIn)

        // Second pool has the desired token pair && current amountOut > previous amountOut
        if (tokenIn === pool2TokenIn && pool2AmtIn.lt(amountIn)) {
          console.log("pool2AmtIn", pool2AmtIn.toString())
          amountIn = pool2AmtIn
          poolPath = [pool2, pool3]
          tokenPath = [
            { tokenIn, tokenOut: pool3TokenIn },
            { tokenIn: pool3TokenIn, tokenOut }
          ]
          continue;
        }

        for (let k = 0; k < this.tokenPools![pool2TokenIn]!.length; k++) {
          let pool1 = this.tokenPools![pool2TokenIn]![k]
          let pool1TokenIn = this.getOtherToken(pool1, pool2TokenIn)

          // Second pool has the desired token pair && current amountOut > previous amountOut
          if (tokenIn === pool1TokenIn) {
            pool1AmtIn = await this.getAmountIn(pool2AmtIn, pool1, pool1TokenIn)

            if (pool1AmtIn.lt(amountOut)) {
              console.log("pool1AmtIn", pool1AmtIn.toString())
              amountIn = pool1AmtIn
              poolPath = [pool1, pool2, pool3]
              tokenPath = [
                { tokenIn, tokenOut: pool2TokenIn },
                { tokenIn: pool2TokenIn, tokenOut: pool3TokenIn },
                { tokenIn: pool3TokenIn, tokenOut }
              ]
              continue;
            }
          }
        }
      }
    }

    // Check Balance and Allowance
    await this.checkAllowance(tokenIn, amountIn)
    await this.checkBalance(tokenIn, amountIn)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (poolPath.length === 1) {
      txn = {
        transition: "SwapTokensForExactZILOnce",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('amount_in_max', 'Uint128', `${amountInMax}`),
          this.param('pool', 'ByStr20', poolPath[0]),
          this.param('path', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 2) {
      txn = {
        transition: "SwapTokensForExactZILTwice",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('amount_in_max', 'Uint128', `${amountInMax}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        },
      }
    }
    else if (poolPath.length === 3) {
      txn = {
        transition: "SwapTokensForExactZILThrice",
        args: [
          this.param('amount_out', 'Uint128', `${amountOut}`),
          this.param('amount_in_max', 'Uint128', `${amountInMax}`),
          this.param('pool1', 'ByStr20', poolPath[0]),
          this.param('pool2', 'ByStr20', poolPath[1]),
          this.param('pool3', 'ByStr20', poolPath[2]),
          this.param('path1', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[0].tokenIn}`, `${tokenPath[0].tokenOut}`]
          }),
          this.param('path2', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[1].tokenIn}`, `${tokenPath[1].tokenOut}`]
          }),
          this.param('path3', 'Pair ByStr20 ByStr20', {
            "constructor": "Pair",
            "argtypes": ["ByStr20", "ByStr20"],
            "arguments": [`${tokenPath[2].tokenIn}`, `${tokenPath[2].tokenOut}`]
          }),
          this.param('deadline_block', 'BNum', `${deadline}`),
        ],
        params: {
          amount: new BN(0),
          ...this.txParams()
        }
      }
    }
    else {
      throw new Error("There is no pool with the desired token pair")
    }

    const swapTokensForExactZILTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)
    if (swapTokensForExactZILTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    // Update relevant app states
    for (var pool of poolPath) {
      await this.updateSinglePoolState(pool)
    }
    await this.updateZILBalanceAndNonce()

    return swapTokensForExactZILTxn
  }

  /////////////////////// Blockchain Helper functions //////////////////

  // Deploy new contract
  private async deployContract(file: string, init: Value[]) {
    console.log("Deploying ZilSwapV2Pool...")
    const code = await compile(file)
    const contract = this.zilliqa.contracts.new(code, init)
    const [deployTx, s] = await contract.deployWithoutConfirm(this._txParams, false)

    // Check for txn acceptance
    if (!deployTx.id) {
      throw new Error(JSON.stringify(s.error || 'Failed to get tx id!', null, 2))
    }
    console.info(`Deployment transaction id: ${deployTx.id}`)

    const confirmedTx = await deployTx.confirm(deployTx.id, 33, 1000);

    // Check for txn execution success
    if (!confirmedTx.txParams.receipt!.success) {
      const errors = confirmedTx.txParams.receipt!.errors || {}
      const errMsgs = JSON.stringify(
        Object.keys(errors).reduce((acc, depth) => {
          const errorMsgList = errors[depth].map((num: any) => TransactionError[num])
          return { ...acc, [depth]: errorMsgList }
        }, {}))
      const error = `Failed to deploy contract at ${file}!\n${errMsgs}`
      throw new Error(error)
    }

    // Add to observedTx
    const deadline = this.deadlineBlock()
    const observeTxn = {
      hash: confirmedTx.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    const deployedContract = this.getContract(s.address!)
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
      // tx = await contract.callWithoutConfirm(transition, args, params, toDs)
      tx = await (contract as any).call(transition, args, params, toDs)
    }

    const receipt = tx.getReceipt()
    console.log(`${transition} receipt`, receipt)

    if (receipt && !receipt.success) {
      const errors = receipt.errors
      if (errors) {
        const errMsgs = Object.keys(errors).reduce((acc, depth) => {
          const errorMsgList = errors[depth].map((num: any) => TransactionError[num])
          return { ...acc, [depth]: errorMsgList }
        }, {})
        console.info(`Contract call for ${transition} failed:\n${JSON.stringify(errMsgs, null, 2)}\n` +
          `${receipt.exceptions ? `Exceptions:\n${JSON.stringify(receipt.exceptions, null, 2)}\n` : ''}` +
          `Parameters:\n${JSON.stringify(args)}\n`
        )
      }
    }
    return tx
  }

  // Method created for testing such that the nonce is correct
  public async increaseAllowance(contract: Contract, spender: string, allowance: string): Promise<Transaction> {

    const args: any = [
      this.param('spender', 'ByStr20', spender),
      this.param('amount', 'Uint128', allowance)
    ]

    const params: CallParams = {
      amount: new BN(0),
      ...this.txParams()
    }

    // Call contract
    const increaseAllowanceTxn = await this.callContract(contract, 'IncreaseAllowance', args, params, true)

    if (increaseAllowanceTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    // Update relevant app state
    await this.updateZILBalanceAndNonce()

    return increaseAllowanceTxn
  }

  // Check Allowance
  private async checkAllowance(tokenHash: string, amount: string | BigNumber) {
    // Check init
    this.checkAppLoadedWithUser()
    const user = this.currentUser!

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

  // Check Balance
  private async checkBalance(tokenHash: string, amount: string | BigNumber) {
    // Check init
    this.checkAppLoadedWithUser()
    const user = this.currentUser!

    // Check zrc-2 balance
    if (tokenHash === ZIL_HASH) {
      // Check zil balance
      const zilBalance = this.currentZILBalance!
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

  // tokenID: token hash
  public toUnit(tokenID: string, amountStr: string): string {
    const tokenDetails = this.getTokenDetails(tokenID)
    const amountBN = new BigNumber(amountStr)
    if (!amountBN.integerValue().isEqualTo(amountStr)) {
      throw new Error(`Amount ${amountStr} for ${tokenDetails.symbol} cannot have decimals.`)
    }
    return amountBN.shiftedBy(-tokenDetails.decimals).toString()
  }

  // Obtains token details  
  private async fetchTokenDetails(hash: string): Promise<TokenDetails> {

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
    if (!this.tokens) {
      throw new Error('App state not loaded, call #initialize first.')
    }
    if (!this.tokens[hash]) {
      throw new Error(`Could not find token details for ${hash}`)
    }
    return this.tokens[hash]!
  }

  // Returns the token hash of the other token in the pool
  private getOtherToken(pool: string, token: string) {
    const token0 = this.poolStates![pool]!.token0
    const token1 = this.poolStates![pool]!.token1
    if (token === token0) {
      return token1
    }
    else {
      return token0
    }
  }

  private quote(amountA: string | number | BigNumber, reserveA: string | number | BigNumber, reserveB: string | number | BigNumber): BigNumber {
    return new BigNumber(amountA).multipliedBy(reserveB).dividedToIntegerBy(reserveA)
  }

  private getTradeInfo(reserve0: string, reserve1: string, vReserve0: string, vReserve1: string, isNotAmpPool: boolean, isSameOrder: boolean) {
    if (isNotAmpPool) {
      if (isSameOrder) {
        return {
          reserveIn: reserve0,
          reserveOut: reserve1,
          vReserveIn: reserve0,
          vReserveOut: reserve1
        }
      }
      else {
        return {
          reserveIn: reserve1,
          reserveOut: reserve0,
          vReserveIn: reserve1,
          vReserveOut: reserve0
        }
      }
    }
    else {
      if (isSameOrder) {
        return {
          reserveIn: reserve0,
          reserveOut: reserve1,
          vReserveIn: vReserve0,
          vReserveOut: vReserve1
        }
      }
      else {
        return {
          reserveIn: reserve1,
          reserveOut: reserve0,
          vReserveIn: vReserve1,
          vReserveOut: vReserve0
        }
      }
    }
  }

  // return ((precision - alpha) * ema + alpha * value) / precision; 
  private getEma(ema: string | number | BigNumber, alpha: string | number | BigNumber, value: string | number | BigNumber) {
    const a = new BigNumber(PRECISION).minus(alpha).multipliedBy(ema)
    const b = new BigNumber(alpha).multipliedBy(value)
    return (a.plus(b)).dividedToIntegerBy(PRECISION)
  }

  private getRFactor(pool: string) {
    const currentBlock = new BigNumber(this.getCurrentBlock())
    const poolState = this.poolStates![pool]
    const oldShortEMA = new BigNumber(poolState!.short_ema)
    const oldLongEMA = new BigNumber(poolState!.long_ema)
    const currentBlockVolume = new BigNumber(poolState!.current_block_volume)
    const lastTradeBlock = new BigNumber(poolState!.last_trade_block).isZero() ? currentBlock : new BigNumber(poolState!.last_trade_block)

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

    const rFactor = new BigNumber(rFactorInPrecision)
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

  private getFinalFee(feeInPrecision: string | number | BigNumber, ampBps: string | number | BigNumber) {
    const amp = new BigNumber(ampBps)
    if (amp.lte(20000)) {
      return new BigNumber(feeInPrecision)
    }
    else if (amp.lte(50000)) {
      return this.frac(feeInPrecision, 20, 30)
    }
    else if (amp.lte(200000)) {
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

  // return (x*y)/z
  private frac(x: string | number | BigNumber, y: string | number | BigNumber, z: string | number | BigNumber): BigNumber {
    return new BigNumber(x).multipliedBy(y).dividedToIntegerBy(z)
  }

  // return (x*y)/PRECISION
  private mulInPrecision(x: string | number | BigNumber, y: string | number | BigNumber): BigNumber {
    return this.frac(x, y, PRECISION)
  }

  // Used for calculating the output amount for swapping with exact inputs
  private async getAmountOut(amountIn: string | number | BigNumber, pool: string, tokenIn: string) {
    // Update pool state of specified pool
    await this.updateSinglePoolState(pool)

    const poolState = this.poolStates![pool]

    if (!poolState) {
      throw new Error("Pool does not exist")
    }

    // Obtain pool state
    const token0 = poolState.token0
    const reserve0 = poolState.reserve0
    const reserve1 = poolState.reserve1
    const v_reserve0 = poolState.v_reserve0
    const v_reserve1 = poolState.v_reserve1
    const ampBps = poolState.amp_bps

    const isNotAmpPool = !(ampBps === BASIS.toString())
    const isSameOrder = tokenIn === token0

    // Calculate feeInPrecision
    const rFactorInPrecision = this.getRFactor(pool)
    const intermediateFee = this.getFee(rFactorInPrecision)
    const feeInPrecision = this.getFinalFee(intermediateFee, ampBps)
    const { reserveIn, reserveOut, vReserveIn, vReserveOut } = this.getTradeInfo(reserve0, reserve1, v_reserve0, v_reserve1, isNotAmpPool, isSameOrder)

    // get_amount_out
    const precisionMinusFee = new BigNumber(PRECISION).minus(feeInPrecision)
    const amountInWithFee = this.frac(amountIn, precisionMinusFee, PRECISION)
    const numerator = amountInWithFee.multipliedBy(vReserveOut)
    const denominator = amountInWithFee.plus(vReserveIn)
    return numerator.dividedToIntegerBy(denominator)
  }

  private async getAmountIn(amountOut: string | number | BigNumber, pool: string, tokenIn: string) {
    // Update pool state of specified pool
    await this.updateSinglePoolState(pool)

    const poolState = this.poolStates![pool]

    if (!poolState) {
      throw new Error("Pool does not exist")
    }

    // Obtain pool state
    const token0 = poolState.token0
    const reserve0 = poolState.reserve0
    const reserve1 = poolState.reserve1
    const v_reserve0 = poolState.v_reserve0
    const v_reserve1 = poolState.v_reserve1
    const ampBps = poolState.amp_bps

    const isNotAmpPool = !(ampBps === BASIS.toString())
    const isSameOrder = tokenIn === token0

    // Calculate feeInPrecision
    const rFactorInPrecision = this.getRFactor(pool)
    const intermediateFee = this.getFee(rFactorInPrecision)
    const feeInPrecision = this.getFinalFee(intermediateFee, ampBps)
    const { reserveIn, reserveOut, vReserveIn, vReserveOut } = this.getTradeInfo(reserve0, reserve1, v_reserve0, v_reserve1, isNotAmpPool, isSameOrder)

    // get_amount_in
    let numerator = new BigNumber(vReserveIn).multipliedBy(amountOut)
    let denominator = new BigNumber(vReserveOut).minus(amountOut)
    let amountIn = numerator.dividedToIntegerBy(denominator).plus(1)
    numerator = amountIn.multipliedBy(PRECISION)
    denominator = new BigNumber(PRECISION).minus(feeInPrecision)
    return numerator.plus(denominator.minus(1)).dividedToIntegerBy(denominator)
  }

  /////////////////////// App Helper functions //////////////////

  private async updateAppState(): Promise<void> {
    await this.updateRouterState()
    await this.updatePoolStates()
    await this.updateTokens()
    await this.updateBlockHeight()
    await this.updateZILBalanceAndNonce()
    this.updateTokenPools()
  }

  // Updates the router state
  private async updateRouterState(): Promise<void> {
    const requests: BatchRequest[] = []
    const address = this.contractHash.replace('0x', '')
    requests.push({ id: '1', method: 'GetSmartContractSubState', params: [address, 'pool_codehash', []], jsonrpc: '2.0' })
    requests.push({ id: '2', method: 'GetSmartContractSubState', params: [address, 'all_pools', []], jsonrpc: '2.0' })
    requests.push({ id: '3', method: 'GetSmartContractSubState', params: [address, 'pools', []], jsonrpc: '2.0' })
    requests.push({ id: '4', method: 'GetSmartContractSubState', params: [address, 'unamplified_pools', []], jsonrpc: '2.0' })
    requests.push({ id: '5', method: 'GetSmartContractSubState', params: [address, 'fee_configuration', []], jsonrpc: '2.0' })

    const result = await sendBatchRequest(this.rpcEndpoint, requests)
    // console.log("updateRouterState result", result)

    // console.log("Object.values(result)", Object.values(result))

    const routerState = Object.values(result).reduce((a, i) => ({ ...a, ...i }), {}) as RouterState
    this.routerState = routerState;

    // Log out to see what is the object type
    // console.log("this.routerState", this.routerState)
  }

  // Updates the state of all pools
  private async updatePoolStates(): Promise<void> {
    if (this.routerState) {
      const allPools = this.routerState.all_pools
      // console.log("allPools", allPools)

      if (allPools.length === 0) { // If there is no pool
        this.poolStates = {}
        return
      }

      const poolStates: { [key in string]?: PoolState } = {}

      for (let poolHash of allPools) {
        const requests: BatchRequest[] = []

        // console.log("poolHash", poolHash)
        const address = poolHash.replace('0x', '')
        // console.log("address", address)

        requests.push({ id: '1', method: 'GetSmartContractState', params: [address], jsonrpc: '2.0' })
        const result = await sendBatchRequest(this.rpcEndpoint, requests)
        // console.log("result", result)
        const poolState = Object.values(result).reduce((a, i) => ({ ...a, ...i }), {})
        poolStates[poolHash] = poolState;
      }
      this.poolStates = poolStates
      // console.log("poolStates", this.poolStates)
    }
  }

  private async updateTokens(): Promise<void> {
    const tokenHash: string[] = []
    const poolStates = this.poolStates!

    // Obtain an array of token hashes that are used in the pools
    if (Object.keys(poolStates).length !== 0) {
      Object.keys(poolStates).map((poolAddress) => {
        // Add LP tokens
        tokenHash.push(poolAddress)

        // Add zrc2 tokens
        const token0 = poolStates[poolAddress]!.token0
        const token1 = poolStates[poolAddress]!.token1
        if (!tokenHash.includes(token0)) {
          tokenHash.push(token0)
        }
        if (!tokenHash.includes(token1)) {
          tokenHash.push(token1)
        }
      })
      // console.log("tokenHash", tokenHash)

      // Fetch the token details using the token hash
      const tokens: { [key in string]: TokenDetails } = {} // tokenAddress: tokenDetails
      const promises = tokenHash.map(async (hash) => {
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

      this.tokens = tokens;
      // console.log("this.tokens", this.tokens)
    }
    else {
      this.tokens = {}
    }
  }

  private updateTokenPools(): void {
    const tokenPools: { [key in string]?: string[] } = {}
    if (Object.keys(this.tokens!).length === 0) {
      this.tokenPools = {}
      return;
    }

    Object.keys(this.poolStates!).map((poolAddress) => {
      const poolState = this.poolStates![poolAddress]
      const token0 = poolState!.token0
      const token1 = poolState!.token1

      if (!tokenPools[token0]) {
        tokenPools[token0] = [poolAddress]
      }
      else {
        const token0Pools = tokenPools[token0]
        token0Pools!.push(poolAddress)
        tokenPools[token0] = token0Pools
      }

      if (!tokenPools[token1]) {
        tokenPools[token1] = [poolAddress]
      }
      else {
        const token1Pools = tokenPools[token1]
        token1Pools!.push(poolAddress)
        tokenPools[token1] = token1Pools
      }
    })
    this.tokenPools = tokenPools
  }

  // Updates the user's ZIL balance and nonce
  private async updateZILBalanceAndNonce() {
    if (this.currentUser) {
      try {
        const res: RPCBalanceResponse = (await this.zilliqa.blockchain.getBalance(this.currentUser)).result
        // console.log(res)
        if (!res) {
          this.currentZILBalance = new BigNumber(0)
          this.currentNonce = 0
          return
        }
        this.currentZILBalance = new BigNumber(res.balance)
        this.currentNonce = parseInt(res.nonce, 10)
      } catch (err) {
        // ugly hack for zilpay non-standard API
        if ((err as any).message === 'Account is not created') {
          this.currentZILBalance = new BigNumber(0)
          this.currentNonce = 0
        }
      }

    }
    else {
      this.currentZILBalance = null
      this.currentNonce = null
    }
    // console.log("this.currentZILBalance", this.currentZILBalance)
    // console.log("this.currentNonce", this.currentNonce)
  }

  // Updates the poolState of a single pool
  // To be used when the state of a single pool has changed
  private async updateSinglePoolState(poolHash: string) {
    if (!this.poolStates![poolHash]) {
      throw new Error("Pool does not exist")
    }

    const requests: BatchRequest[] = []
    const address = poolHash.replace('0x', '')
    requests.push({ id: '1', method: 'GetSmartContractState', params: [address], jsonrpc: '2.0' })
    const result = await sendBatchRequest(this.rpcEndpoint, requests)
    const poolState = Object.values(result).reduce((a, i) => ({ ...a, ...i }), {})
    this.poolStates![poolHash] = poolState;
  }

  // Check if the user is loggged in
  public checkAppLoadedWithUser() {
    if (!this.routerState) {
      throw new Error('App state not loaded, call #initialize first.')
    }

    // Check user address
    if (this.currentUser === null) {
      throw new Error('No wallet connected.')
    }

    // Check wallet account
    if (this.walletProvider && this.walletProvider.wallet.defaultAccount.base16.toLowerCase() !== this.currentUser) {
      throw new Error('Wallet user has changed, please reconnect.')
    }

    // Check network is correct
    if (this.walletProvider && this.walletProvider.wallet.net.toLowerCase() !== this.network.toLowerCase()) {
      throw new Error('Wallet is connected to wrong network.')
    }
  }

  public txParams(): TxParams & { nonce: number } {
    return {
      nonce: this.nonce(),
      ...this._txParams,
    }
  }

  private nonce(): number {
    return this.currentNonce! + 1

    // return this.currentNonce! + this.observedTxs.length + 1
  }

  public getCurrentBlock(): number {
    return this.currentBlock
  }

  public deadlineBlock(): number {
    return this.currentBlock + this.deadlineBuffer!
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

  private async updateBlockHeight(): Promise<void> {
    // // change back when converting to mainnet
    // const response = await this.zilliqa.blockchain.getNumTxBlocks()
    // const bNum = parseInt(response.result!, 10)
    // this.currentBlock = bNum


    const response = await this.zilliqa.blockchain.getLatestTxBlock()
    const bNum = parseInt(response.result!.header.BlockNum, 10)
    this.currentBlock = bNum
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
      console.log("observedTxs length", this.observedTxs.length)
    } finally {
      release()
    }
  }

  public getRouterState(): RouterState | undefined {
    return this.routerState
  }

  public getPoolStates(): { [key in string]?: PoolState } | undefined {
    return this.poolStates
  }

  public getTokenPools(): { [key in string]?: string[] } | undefined {
    return this.tokenPools
  }

  public getTokens(): { [key in string]?: TokenDetails } | undefined {
    return this.tokens
  }

  private param = (vname: string, type: string, value: any) => {
    return { vname, type, value };
  }
}