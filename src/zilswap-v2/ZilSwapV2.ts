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
import { APIS, CHAIN_VERSIONS, Network, ZILSWAPV2_CONTRACTS } from '../constants'
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
  token0Reserve: string
  token0VReserve: string
  token1Reserve: string
  token1VReserve: string
  ampBps: string
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

  // User's ZRC2 balance
  private currentZRC2Balance?: { [key in string]?: BigNumber } // tokenHash : userZRC2balance

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

    return pool
  }

  // Call AddPool transition on the router
  // To be used together with the DeployPool
  public async addPool(poolAddress: string): Promise<Transaction> {
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

    await this.updateAppState()
    return addPoolTx
  }

  // reserve_ratio_allowance: in percentage
  public async addLiquidity(tokenA: string, tokenB: string, pool: string, amountA_desired: number, amountB_desired: number, amountA_min: number, amountB_min: number, reserve_ratio_allowance: number, to: string): Promise<Transaction> {

    if (this.routerState!.all_pools.includes(pool)) {
      const poolState = this.poolStates![pool]
      const q112 = new BigNumber(2).pow(112)
      const v_reserve_a = new BigNumber(poolState!.token0VReserve)
      const v_reserve_b = new BigNumber(poolState!.token1VReserve)
      const ratio = v_reserve_b.dividedBy(v_reserve_a)

      const v_reserve_min: string = new BigNumber(q112.multipliedBy(ratio).dividedBy(1 + reserve_ratio_allowance / 100)).toString(10)
      const v_reserve_max: string = new BigNumber(q112.multipliedBy(ratio).multipliedBy(1 + reserve_ratio_allowance / 100)).toString(10)

      const contract: Contract = this.contract
      const args: any = [
        this.param('tokenA', 'ByStr20', tokenA),
        this.param('tokenB', 'ByStr20', tokenB),
        this.param('pool', 'ByStr20', pool),
        this.param('amountB_desired', 'Uint128', `${amountA_desired}`),
        this.param('amountB_desired', 'Uint128', `${amountB_desired}`),
        this.param('amountA_min', 'Uint128', `${amountA_min}`),
        this.param('amountB_min', 'Uint128', `${amountB_min}`),
        this.param('v_reserve_ratio_bounds', 'Pair (Uint256) (Uint256)',
          {
            "constructor": "Pair",
            "argtypes": ["Uint256", "Uint256"],
            "arguments": [`${v_reserve_min}`, `${v_reserve_max}`]
          }),
        // this.param('to', 'ByStr20', to)
      ]
      const params: CallParams = {
        amount: new BN(0),
        ...this.txParams()
      }

      const tx = await this.callContract(contract, 'AddLiquidity', args, params, true)
      if (!tx.id) {
        throw new Error(JSON.stringify('Failed to get tx id!', null, 2))
      }

      await this.updatePoolStates() // might want to have a method that only updates the state of one pool
      return tx
    }
    else {
      throw new Error('Pool does not exist')
    }
  }

  public async removeLiquidity(tokenA: string, tokenB: string, pool: string, liquidity: number, amountA_min: number, amountB_min: number) {

    if (this.routerState!.all_pools.includes(pool)) {
      const contract: Contract = this.contract
      const args: any = [
        this.param('tokenA', 'ByStr20', tokenA),
        this.param('tokenB', 'ByStr20', tokenB),
        this.param('pool', 'ByStr20', pool),
        this.param('liquidity', 'Uint128', `${liquidity}`),
        this.param('amountA_min', 'Uint128', `${amountA_min}`),
        this.param('amountB_min', 'Uint128', `${amountB_min}`),
      ]
      const params: CallParams = {
        amount: new BN(0),
        ...this.txParams()
      }

      const tx = await this.callContract(contract, 'RemoveLiquidity', args, params, true)
      if (!tx.id) {
        throw new Error(JSON.stringify('Failed to get tx id!', null, 2))
      }
    }
    else {
      throw new Error('Pool does not exist')
    }
  }

  public async addLiquidityZIL() {
  }

  public async removeLiquidityZIL() {
  }

  /////////////////////// Blockchain Helper functions //////////////////

  // Deploy new contract
  private async deployContract(file: string, init: Value[]) {
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
    if (this.walletProvider) {
      // ugly hack for zilpay provider
      const txn = await (contract as any).call(transition, args, params, toDs)
      txn.id = txn.ID
      txn.isRejected = function (this: { errors: any[]; exceptions: any[] }) {
        return this.errors.length > 0 || this.exceptions.length > 0
      }
      return txn
    } else {
      // const txn = await contract.callWithoutConfirm(transition, args, params, toDs)
      const txn = await (contract as any).call(transition, args, params, toDs)
      return txn
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

  /////////////////////// App Helper functions //////////////////

  private async updateAppState(): Promise<void> {
    await this.updateRouterState()
    await this.updatePoolStates()
    await this.updateTokens()
    await this.updateZILBalanceAndNonce()
    await this.updateCurrentZRC2Balance()
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

  private async updateCurrentZRC2Balance() {
    if (this.currentUser && this.tokens) {
      const tokens = this.tokens
      const requests: BatchRequest[] = []

      Object.keys(tokens).map(async (token) => {
        const address = token.replace('0x', '')
        requests.push({
          id: token,
          method: 'GetSmartContractSubState',
          params: [address, 'balances', [this.currentUser]],
          jsonrpc: '2.0',
        })
      })

      const currentZRC2Balance: { [key in string]: BigNumber } = {}
      const result = await sendBatchRequest(this.rpcEndpoint, requests)
      // console.log("ZRC2Balance", result)
      Object.entries(result).map((t) => {
        const address = t[0]
        const balances = t[1].balances
        currentZRC2Balance[address] = balances
      }
      )
      this.currentZRC2Balance = currentZRC2Balance
      // console.log("this.currentZRC2Balance", this.currentZRC2Balance)
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

  private nonce(): number {
    return this.currentNonce! + this.observedTxs.length + 1
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