import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Provider } from '@zilliqa-js/core'
import { Contract, Value } from '@zilliqa-js/contract'
import { fromBech32Address, toBech32Address } from '@zilliqa-js/crypto'
import { StatusType, MessageType, NewEventSubscription } from '@zilliqa-js/subscriptions'

import { BN, Long, units } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'

import { APIS, WSS, CONTRACTS, TOKENS, CHAIN_VERSIONS, BASIS, Network } from './constants'
import { toPositiveQa } from './utils'

export type Options = {
  deadlineBuffer?: number
  gasPrice?: number
  gasLimit?: number
}

type TxParams = {
  version: number
  gasPrice: BN
  gasLimit: Long
}

type TokenDetails = {
  contract: Contract // instance
  address: string
  hash: string
  symbol: string
  decimals: number
}

type AppState = {
  contractState: object
  currentUser: string | null
  tokens: { [key in string]: TokenDetails }
  pools: { [key in string]?: Pool }
  updatedAtBNum: number
}

type Pool = {
  zilReserve: BigNumber
  tokenReserve: BigNumber
  exchangeRate: BigNumber
  totalContribution: BigNumber
  userContribution: BigNumber
  contributionPercentage: BigNumber
}

class Zilswap {
  /* Internals */
  private readonly zilliqa: Zilliqa
  private readonly tokens: { [key in string]: string } // symbol => hash mappings
  private subscription: NewEventSubscription | null = null
  private appState?: AppState

  /* Zilswap contract attributes */
  readonly contract: Contract
  readonly contractAddress: string
  readonly contractHash: string

  /* Transaction attributes */
  readonly deadlineBuffer: number = 10
  readonly txParams: TxParams = {
    version: -1,
    gasPrice: toPositiveQa(1000, units.Units.Li),
    gasLimit: Long.fromNumber(10000)
  }

  constructor(readonly network: Network, providerOrKey?: Provider | string, options?: Options) {
    if (typeof(providerOrKey) === 'string') {
      this.zilliqa = new Zilliqa(APIS[network])
      this.zilliqa.wallet.addByPrivateKey(providerOrKey)
    } else {
      this.zilliqa = new Zilliqa(APIS[network], providerOrKey)
    }

    this.contractAddress = CONTRACTS[network]
    this.contract = this.zilliqa.contracts.at(this.contractAddress)
    this.contractHash = fromBech32Address(this.contractAddress).toLowerCase()

    this.tokens = TOKENS[network]
    this.txParams.version = CHAIN_VERSIONS[network]

    if (options) {
      if (options.deadlineBuffer) this.deadlineBuffer = options.deadlineBuffer
      if (options.gasPrice) this.txParams.gasPrice = toPositiveQa(options.gasPrice, units.Units.Li)
      if (options.gasLimit) this.txParams.gasLimit = Long.fromNumber(options.gasLimit)
    }
  }

  public async initialize() {
    this.subscribeToAppChanges()
    await this.updateAppState()
  }

  public async teardown() {
    if (this.subscription) {
      this.subscription.stop()
    }
    const stopped = new Promise(resolve => {
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

  public getAppState(): AppState {
    if (!this.appState) {
      throw new Error('App state not loaded, call #initialize first!')
    }
    return this.appState
  }

  /**
   * Gets the pool details for the given `tokenID`.
   *
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @returns {Pool} if pool exists, or `null` otherwise.
   */
  public getPool(tokenID: string): Pool | null {
    if (!this.appState) {
      throw new Error('App state not loaded, call #initialize first!')
    }
    return this.appState.pools[this.getTokenAddresses(tokenID).hash] || null
  }

  /**
   * Adds liquidity to the pool with the given `tokenID`. The given `zilsToAddHuman` represents the exact quantity of ZIL
   * that will be contributed, while the given `tokensToAddHuman` represents the target quantity of ZRC-2 tokens to be
   * contributed.
   *
   * To ensure the liquidity contributor does not lose value to arbitrage, the target token amount should be strictly
   * derived from the current exchange rate that can be found using {@linkcode getPool}.
   *
   * The maximum fluctuation in exchange rate from the given parameters can be controlled through `maxExchangeRateChange`,
   * to protect against changes in pool reserves between the txn submission and txn confirmation on the Zilliqa blockchain.
   *
   * If the pool has no liquidity yet, the token amount given will be the exact quantity of tokens that will be contributed,
   * and the `maxExchangeRateChange` is ignored.
   *
   * Note that all amounts should be given with decimals in it's human represented form, rather than as a unitless integer.
   *
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @param zilsToAddHuman is the exact amount of zilliqas to contribute to the pool in ZILs as a string.
   * @param tokensToAddHuman is the target amount of tokens to contribute to the pool with decimals as a string.
   * @param maxExchangeRateChange is the maximum allowed exchange rate flucuation
   * given in {@link https://www.investopedia.com/terms/b/basispoint.asp |basis points}. Defaults to 200 = 2.00% if not provided.
   */
  public async addLiquidity(tokenID: string, zilsToAddHuman: string, tokensToAddHuman: string, maxExchangeRateChange: number = 200) {
    if (!this.appState) await this.updateAppState()

    // Check user address
    if (this.appState!.currentUser === null) {
      throw new Error('No wllet connected!')
    }

    // Format token amounts
    const token = await this.getTokenDetails(tokenID)
    const tokensToAdd = new BN(toPositiveQa(tokensToAddHuman, token.decimals))
    const zilsToAdd = new BN(toPositiveQa(zilsToAddHuman, units.Units.Zil))

    // Calculate allowances
    const pool = this.getPool(token.hash)
    const zilReserve = pool ? new BN(pool.zilReserve.shiftedBy(12).toString()) : new BN(0)
    const maxTokens = pool ? tokensToAdd.muln(BASIS + maxExchangeRateChange).divn(BASIS) : tokensToAdd
    let minContribution = new BN(0)
    if (pool) {
      // sqrt(delta) * x = max allowed change in zil reserve
      // min contribution = zil added / max zil reserve * current total contributions
      if (maxExchangeRateChange >= BASIS || maxExchangeRateChange < 0) {
        throw new Error(`maxExchangeRateChange: ${maxExchangeRateChange} must be between 0 and ${maxExchangeRateChange}!`)
      }
      const totalContribution = pool.totalContribution
      const numerator = totalContribution.times(zilsToAdd.toString())
      const denominator = new BigNumber(BASIS).plus(maxExchangeRateChange).sqrt().times(zilReserve.toString())
      minContribution = new BN(numerator.dividedToIntegerBy(denominator).toString())
    }
    // console.log(`zilReserve: ${zilReserve.toString()}`)
    // console.log(`maxTokens: ${maxTokens.toString()}, minContribution: ${minContribution.toString()}`)

    // Check balances
    const tokenState = await token.contract.getState()
    const tokenBalance = new BN(tokenState.balances_map[this.appState!.currentUser!] || 0)
    if (tokenBalance.lt(tokensToAdd)) {
      throw new Error('Insufficent tokens in wallet to add liquidity!')
    }
    const zilBalance = new BN((await this.zilliqa.blockchain.getBalance(this.appState!.currentUser)).result.balance)
    if (zilBalance.lt(zilsToAdd)) {
      throw new Error('Insufficent zilliqa in wallet to add liquidity!')
    }

    // We need to pre-approve the transfer of tokens whenever tokens
    // are moved from the user's address
    await this.approveTokenTransferIfRequired(token, tokensToAdd)

    console.log('sending add liquidity txn..')
    const addLiquidityTxn = await this.contract.call('AddLiquidity', [{
      vname: 'token_address',
      type: 'ByStr20',
      value: token.hash,
    }, {
      vname: 'min_contribution_amount',
      type: 'Uint128',
      value: minContribution.toString(),
    }, {
      vname: 'max_token_amount',
      type: 'Uint128',
      value: maxTokens.toString(),
    }, {
      vname: 'deadline_block',
      type: 'BNum',
      value: await this.deadlineBlock(),
    }], {
      amount: zilsToAdd, // _amount
      ...this.txParams
    })
    console.log("add liquidity txn found..")
    const addLiquidityTxnReceipt = addLiquidityTxn.getReceipt()!
    console.log(JSON.stringify(addLiquidityTxnReceipt, null, 4))

    if (!addLiquidityTxnReceipt.success) {
      throw new Error('Failed to add liquidity!')
    }
  }

  private subscribeToAppChanges() {
    const subscription = this.zilliqa.subscriptionBuilder.buildEventLogSubscriptions(WSS[this.network], { addresses: [this.contractHash] })

    subscription.emitter.on(StatusType.SUBSCRIBE_EVENT_LOG, event => {
      console.log('SUBSCRIBE_EVENT_LOG success: ', event)
    })

    subscription.emitter.on(MessageType.EVENT_LOG, event => {
      if (!event.value) return
      console.log('EVENT_LOG new: ', JSON.stringify(event))
      this.updateAppState()
    })

    subscription.emitter.on(MessageType.UNSUBSCRIBE, event => {
      console.log('UNSUBSCRIBE_EVENT_LOG success: ', event)
      this.subscription = null
    })

    subscription.start()

    this.subscription = subscription
  }

  private async updateAppState(): Promise<void> {
    // Get the contract state
    const contractState = await this.contract.getState()

    // Get block number
    const response = await this.zilliqa.blockchain.getNumTxBlocks()
    const bNum = parseInt(response.result!, 10)

    const state: AppState = {
      contractState: contractState, currentUser: this.appState?.currentUser || null,
      tokens: this.appState?.tokens || {}, pools: {}, updatedAtBNum: bNum }

    const tokenHashes = Object.keys(contractState.pools)

    // Get token details
    const promises = tokenHashes.map(async (hash) => {
      const d = await this.getTokenDetails(hash)
      state.tokens[hash] = d
    })
    await Promise.all(promises)

    // Get user address
    state.currentUser = this.zilliqa.wallet.defaultAccount?.address?.toLowerCase() || null

    // Get exchange rates
    tokenHashes.forEach(tokenHash => {
      const [x, y] = contractState.pools[tokenHash].arguments
      const zilReserve = new BigNumber(x).shiftedBy(-12)
      const tokenReserve = new BigNumber(y).shiftedBy(-state.tokens[tokenHash].decimals)
      const exchangeRate = zilReserve.dividedBy(tokenReserve)
      const totalContribution = new BigNumber(contractState.total_contributions[tokenHash])
      const userContribution = new BigNumber(contractState.balances[tokenHash][state.currentUser || ''] || 0)
      const contributionPercentage = userContribution.dividedBy(totalContribution).times(100)

      state.pools[tokenHash] = { zilReserve, tokenReserve, exchangeRate, totalContribution, userContribution, contributionPercentage }
    })

    // Set new state
    this.appState = state
  }

  private getTokenAddresses(id: string) : { hash: string, address: string } {
    let hash, address

    if (id.substr(0, 2) === '0x') {
      hash = id.toLowerCase()
      address = toBech32Address(hash)
    } else if (id.substr(0, 3) == 'zil') {
      address = id
      hash = fromBech32Address(address).toLowerCase()
    } else {
      address = this.tokens[id]
      hash = fromBech32Address(address).toLowerCase()
    }

    return { hash, address }
  }

  private async getTokenDetails(id: string): Promise<TokenDetails> {
    const { hash, address } = this.getTokenAddresses(id)

    if (!!this.appState?.tokens[hash]) return this.appState.tokens[hash]

    const contract = this.zilliqa.contracts.at(address)
    const init = await contract.getInit()

    const decimalStr = init.find((e: Value) => e.vname === 'decimals').value as string
    const decimals = parseInt(decimalStr, 10)
    const symbol = init.find((e: Value) => e.vname === 'symbol').value as string

    return { contract, address, hash, symbol, decimals }
  }

  private async approveTokenTransferIfRequired(token: TokenDetails, amount: BN) {
    const tokenState = await token.contract.getState()
    const allowance = new BN(tokenState.allowances_map[this.appState!.currentUser!][this.contractHash] || 0)

    if (allowance.lt(amount)) {
      console.log('sending approve txn..')
      const approveTxn = await token.contract.call('IncreaseAllowance', [{
        vname: 'spender',
        type: 'ByStr20',
        value: this.contractHash,
      }, {
        vname: 'amount',
        type: 'Uint128',
        value: tokenState.total_supply.toString(),
      }], {
        amount: new BN(0),
        ...this.txParams
      })
      console.log('approve txn found..')
      const approveTxnReceipt = approveTxn.getReceipt()!
      console.log(JSON.stringify(approveTxnReceipt, null, 4))

      if (!approveTxnReceipt.success) {
        throw new Error('Failed to approve token transfer!')
      }
    }
  }

  private async deadlineBlock(): Promise<string> {
    const appState = await this.getAppState()
    return (appState.updatedAtBNum + this.deadlineBuffer!).toString()
  }
}

export { Zilswap }
