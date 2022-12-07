import 'isomorphic-fetch'
import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Wallet, Transaction, TxReceipt as _TxReceipt } from '@zilliqa-js/account'
import { Contract, Value, CallParams } from '@zilliqa-js/contract'
import { fromBech32Address, toBech32Address } from '@zilliqa-js/crypto'
import { StatusType, MessageType, NewEventSubscription } from '@zilliqa-js/subscriptions'
import { BN, Long, units } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'
import { Mutex } from 'async-mutex'

import { APIS, WSS, ZILSWAPV2_CONTRACTS, CHAIN_VERSIONS, BASIS, Network, ZIL_HASH, WHITELISTED_TOKENS } from '../constants'
import { unitlessBigNumber, toPositiveQa, isLocalStorageAvailable } from '../utils'
import { sendBatchRequest, BatchRequest } from '../batch'
import { Zilo, OnStateUpdate } from '../zilo'
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
  registered: boolean // is in default token list
  whitelisted: boolean // is a verified token
}

// V2 Pool contract
export type PoolState = {
  token0: string
  token1: string
  token0Reserve: BigNumber
  token0VReserve: BigNumber
  token1Reserve: BigNumber
  token1VReserve: BigNumber
  ampBps: BigNumber
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

// Check again
export type AppState = {
  routerState: RouterState
  pools: { [key in string]?: PoolState } // poolAddress : poolState
  tokens: { [key in string]?: TokenDetails } // tokenAddress : tokenDetails
  tokenBalance: { [key in string]?: BigNumber } // tokenAddress : userZRC2balance
  currentUser: string | null
  currentNonce: number | null
  currentBalance: BigNumber | null // userZILbalance
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
  private appState?: AppState // cached blockchain state for dApp and user

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
    gasLimit: Long.fromNumber(5000),
  }

  /**
   * Creates the Zilswap-V2 SDK object. {@linkcode initalize} needs to be called after
   * the object is created to begin watching the blockchain's state.
   *
   * @param network the Network to use, either `TestNet` or `MainNet`.
   * @param walletProviderOrKey a Provider with Wallet or private key string to be used for signing txns.
   * @param options a set of Options that will be used for all txns.
   */
  // remember to remove the contractAddress in constructor
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
    this.contractAddress = contractAddress ? contractAddress : ZILSWAPV2_CONTRACTS[network]
    this.contract = (this.walletProvider || this.zilliqa).contracts.at(this.contractAddress)
    this.contractHash = fromBech32Address(this.contractAddress).toLowerCase()

    // Initialize txParams
    this._txParams.version = CHAIN_VERSIONS[network]

    if (options) {
      if (options.deadlineBuffer && options.deadlineBuffer > 0) this.deadlineBuffer = options.deadlineBuffer
      if (options.gasPrice && options.gasPrice > 0) this._txParams.gasPrice = toPositiveQa(options.gasPrice, units.Units.Li)
      if (options.gasLimit && options.gasLimit > 0) this._txParams.gasLimit = Long.fromNumber(options.gasLimit)
    }
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
  }

  public async deployPool(token0Address: string, token1Address: string, init_amp_bps: number) {
    // Check logged in
    this.checkAppLoadedWithUser()

    const token0Contract: Contract = this.getContract(token0Address)
    const token1Contract: Contract = this.getContract(token1Address)

    // Any for now
    const t0State = await this.fetchContractInit(token0Contract)
    const t1State = await this.fetchContractInit(token1Contract)

    const pair = `${t0State.find((i: Value) => i.vname == 'symbol').value}-${t1State.find((i: Value) => i.vname == 'symbol').value}`
    const name = `ZilSwap V2 ${pair} LP Token`
    const symbol = `ZWAPv2LP.${pair}`


    // Load file and contract initialization variables
    const file = `./src/contracts/zilswap-v2/ZilSwapPool.scilla`
    const init = [
      // this parameter is mandatory for all init arrays
      {
        vname: '_scilla_version',
        type: 'Uint32',
        value: '0',
      },
      {
        vname: 'init_token0',
        type: 'ByStr20',
        value: t0State.address.toLowerCase(),
      },
      {
        vname: 'init_token1',
        type: 'ByStr20',
        value: t1State.address.toLowerCase(),
      },
      {
        vname: 'init_factory',
        type: 'ByStr20',
        value: this.contractAddress.toLowerCase(),
      },
      {
        vname: 'init_amp_bps',
        type: 'Uint128',
        value: init_amp_bps,
      },
      {
        vname: 'contract_owner',
        type: 'ByStr20',
        value: this.contractAddress.toLowerCase(),
      },
      {
        vname: 'name',
        type: 'String',
        value: name,
      },
      {
        vname: 'symbol',
        type: 'String',
        value: symbol,
      },
      {
        vname: 'decimals',
        type: 'Uint32',
        value: '12',
      },
      {
        vname: 'init_supply',
        type: 'Uint128',
        value: '0',
      },
    ];
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
      return await contract.callWithoutConfirm(transition, args, params, toDs)
    }
  }

  public checkAppLoadedWithUser() {
    // Check init
    if (!this.appState) {
      throw new Error('App state not loaded, call #initialize first.')
    }

    // Check user address
    if (this.appState!.currentUser === null) {
      throw new Error('No wallet connected.')
    }

    // Check wallet account
    if (this.walletProvider && this.walletProvider.wallet.defaultAccount.base16.toLowerCase() !== this.appState!.currentUser) {
      throw new Error('Wallet user has changed, please reconnect.')
    }

    // Check network is correct
    if (this.walletProvider && this.walletProvider.wallet.net.toLowerCase() !== this.network.toLowerCase()) {
      throw new Error('Wallet is connected to wrong network.')
    }
  }
}