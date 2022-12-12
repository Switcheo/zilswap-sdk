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
import { compile } from './util'
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
  token0: string
  token1: string
  reserve0: string
  v_reserve0: string
  reserve1: string
  v_reserve1: string
  amp_bps: string
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
  private poolStates?: { [key in string]?: PoolState } // poolHash : poolState

  // Mapping of tokens in pools to TokenDetails
  private tokens?: { [key in string]?: TokenDetails } // tokenHash : tokenDetails

  private currentUser?: string | null
  private currentNonce?: number | null

  // User's zil balance
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

    // initialize Internals
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

    // Initialize current user
    // Get user address
    this.currentUser = this.walletProvider
      ? // ugly hack for zilpay provider
      this.walletProvider.wallet.defaultAccount.base16.toLowerCase()
      : this.zilliqa.wallet.defaultAccount?.address?.toLowerCase() || null

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
    await this.updateAppState()

    return pool
  }

  // Call AddPool transition on the router
  // To be used together with the DeployPool
  public async addPool(poolAddress: string): Promise<Transaction> {
    // Check logged in
    this.checkAppLoadedWithUser()

    const contract: Contract = this.contract
    const args: any = [
      this.param('pool', 'ByStr20', poolAddress)
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
    await this.updateAppState()

    return addPoolTx
  }

  // reserve_ratio_allowance: in percentage
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
    const tokenAReserve = new BigNumber(poolState.reserve0, 10)
    const tokenBReserve = new BigNumber(poolState.reserve1, 10)
    let amountA, amountB

    if (tokenAReserve.isZero() && tokenBReserve.isZero()) {
      amountA = new BigNumber(amountA_desired)
      amountB = new BigNumber(amountB_desired)
    }
    else {
      const amountBOptimal = this.quote(new BigNumber(amountA_desired), tokenAReserve, tokenBReserve)
      if (amountBOptimal.lte(amountB_desired)) {
        amountA = new BigNumber(amountA_desired)
        amountB = new BigNumber(amountBOptimal)
      }
      else {
        const amountAOptimal = this.quote(new BigNumber(amountB_desired), tokenBReserve, tokenAReserve)
        amountA = new BigNumber(amountAOptimal)
        amountB = new BigNumber(amountB_desired)
      }
    }

    // Check Balance and Allowance
    this.checkAllowance(tokenA, amountA)
    this.checkAllowance(tokenB, amountB)
    this.checkBalance(tokenA, amountA)
    this.checkBalance(tokenB, amountB)

    // Generate contract args
    const ampBps = new BigNumber(poolState!.amp_bps)
    const isAmpPool = !ampBps.isEqualTo(BASIS)

    let v_reserve_min, v_reserve_max

    if (tokenAReserve.isZero() && tokenBReserve.isZero()) {
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
    await this.updateAppState()

    return addLiquidityTxn
  }

  // reserve_ratio_allowance: in percentage
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
    const tokenAReserve = new BigNumber(poolState.reserve0, 10)
    const tokenBReserve = new BigNumber(poolState.reserve1, 10)
    let amountToken, amountWZIL

    if (tokenAReserve.isZero() && tokenBReserve.isZero()) {
      amountToken = new BigNumber(amount_token_desired)
      amountWZIL = new BigNumber(amount_wZIL_desired)
    }
    else {
      const amountWZILOptimal = await this.quote(new BigNumber(amount_token_desired), tokenAReserve, tokenBReserve)
      if (amountWZILOptimal.lte(amount_wZIL_desired)) {
        amountToken = new BigNumber(amount_token_desired)
        amountWZIL = new BigNumber(amountWZILOptimal)
      }
      else {
        const amountTokenOptimal = await this.quote(new BigNumber(amount_wZIL_desired), tokenBReserve, tokenAReserve)
        amountToken = new BigNumber(amountTokenOptimal)
        amountWZIL = new BigNumber(amount_wZIL_desired)
      }
    }

    // Check Balance and Allowance
    this.checkAllowance(token, amountToken)
    this.checkBalance(token, amountToken)
    this.checkBalance(ZIL_HASH, amountWZIL)

    // Generate contract args
    const ampBps = new BigNumber(poolState!.amp_bps)
    const isAmpPool = !ampBps.isEqualTo(BASIS)

    let v_reserve_min, v_reserve_max

    if (tokenAReserve.isZero() && tokenBReserve.isZero()) {
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
    await this.updateAppState()

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
    this.checkAllowance(this.contractHash, new BigNumber(liquidity))
    this.checkBalance(this.contractHash, new BigNumber(liquidity))

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

    await this.updatePoolStates() // might want to have a method that only updates the state of one pool
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
    this.checkAllowance(this.contractHash, new BigNumber(liquidity))
    this.checkBalance(this.contractHash, new BigNumber(liquidity))

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

    await this.updatePoolStates() // might want to have a method that only updates the state of one pool
    return removeLiquidityZilTxn
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
  // 
  public async increaseAllowance(contract: Contract, spender: string, allowance: string): Promise<void> {

    const args: any = [
      this.param('spender', 'ByStr20', spender),
      this.param('amount', 'Uint128', allowance)
    ]

    const params: CallParams = {
      amount: new BN(0),
      ...this.txParams()
    }

    // Call contract
    await this.callContract(contract, 'IncreaseAllowance', args, params, true)

    // Update app state
    await this.updateAppState()
  }

  // Check Allowance
  private async checkAllowance(tokenHash: string, amount: BigNumber) {
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
  private async checkBalance(tokenHash: string, amount: BigNumber) {
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

  private quote(amountA: BigNumber, reserveA: BigNumber, reserveB: BigNumber): BigNumber {
    return new BigNumber(amountA).multipliedBy(reserveB).dividedBy(reserveA)
  }

  /////////////////////// App Helper functions //////////////////

  private async updateAppState(): Promise<void> {
    await this.updateRouterState()
    await this.updatePoolStates()
    await this.updateTokens()
    await this.updateBlockHeight()
    await this.updateZILBalanceAndNonce()
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
        return
      }

      const poolStates: { [key in string]?: PoolState } = {}

      for (let poolHash of allPools) {
        const requests: BatchRequest[] = []

        // console.log("poolHash", poolHash)
        const address = poolHash.replace('0x', '')
        // console.log("address", address)
        requests.push({ id: '1', method: 'GetSmartContractSubState', params: [address, 'token0', []], jsonrpc: '2.0' })
        requests.push({ id: '2', method: 'GetSmartContractSubState', params: [address, 'token1', []], jsonrpc: '2.0' })
        requests.push({ id: '3', method: 'GetSmartContractSubState', params: [address, 'reserve0', []], jsonrpc: '2.0' })
        requests.push({ id: '4', method: 'GetSmartContractSubState', params: [address, 'v_reserve0', []], jsonrpc: '2.0' })
        requests.push({ id: '5', method: 'GetSmartContractSubState', params: [address, 'reserve1', []], jsonrpc: '2.0' })
        requests.push({ id: '6', method: 'GetSmartContractSubState', params: [address, 'v_reserve1', []], jsonrpc: '2.0' })
        requests.push({ id: '7', method: 'GetSmartContractSubState', params: [address, 'amp_bps', []], jsonrpc: '2.0' })
        requests.push({ id: '8', method: 'GetSmartContractSubState', params: [address, 'balances', []], jsonrpc: '2.0' })
        requests.push({ id: '9', method: 'GetSmartContractSubState', params: [address, 'allowances', []], jsonrpc: '2.0' })

        const result = await sendBatchRequest(this.rpcEndpoint, requests)
        // console.log("result", result)
        const poolSubState = Object.values(result).reduce((a, i) => ({ ...a, ...i }), {})
        poolStates[poolHash] = poolSubState;
      }
      this.poolStates = poolStates
      // console.log("poolState", this.poolState)
    }
  }

  private async updateTokens(): Promise<void> {
    // Obtain an array of token hashes that are used in the pools
    if (this.poolStates) {
      const tokenHash: string[] = []
      const poolStates = this.poolStates
      if (poolStates) {
        if (Object.keys(poolStates).length != 0) { // if there are poolStates
          Object.keys(poolStates).map((poolAddress) => {
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
        }
      }

      // fetch the token details using the token hash
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
            return
          }
          throw err
        }
      })
      await Promise.all(promises)

      this.tokens = tokens;
      // console.log("this.tokens", this.tokens)
    }
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
      // console.log("this.currentZILBalance", this.currentZILBalance)
      // console.log("this.currentNonce", this.currentNonce)
    }
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

  public getTokens(): { [key in string]?: TokenDetails } | undefined {
    return this.tokens
  }

  private param = (vname: string, type: string, value: any) => {
    return { vname, type, value };
  }
}