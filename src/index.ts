import 'isomorphic-fetch'
import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Wallet, Transaction, TxReceipt as _TxReceipt } from '@zilliqa-js/account'
import { Contract, Value, CallParams } from '@zilliqa-js/contract'
import { fromBech32Address, toBech32Address } from '@zilliqa-js/crypto'
import { StatusType, MessageType, NewEventSubscription } from '@zilliqa-js/subscriptions'
import { BN, Long, units } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'
import { Mutex } from 'async-mutex'

import { APIS, WSS, CONTRACTS, CHAIN_VERSIONS, BASIS, Network, ZIL_HASH } from './constants'
import { toPositiveQa } from './utils'

BigNumber.config({ EXPONENTIAL_AT: 1e9 }) // never!

export type Options = {
  deadlineBuffer?: number
  gasPrice?: number
  gasLimit?: number
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

export type TokenDetails = {
  contract: Contract // instance
  address: string
  hash: string
  symbol: string
  decimals: number
  whitelisted: boolean // is in default token list
}

export type ContractState = {
  _balance: string
  balances: { [key in string]?: { [key2 in string]?: string } }
  output_after_fee: string
  owner: string
  pending_owner: string
  pools: { [key in string]?: { arguments: ReadonlyArray<string> } }
  total_contributions: { [key in string]?: string }
}

export type AppState = {
  contractState: ContractState
  tokens: { [key in string]: TokenDetails }
  pools: { [key in string]?: Pool }
  currentUser: string | null
  currentNonce: number | null
  currentBalance: BigNumber | null
}

export type Pool = {
  zilReserve: BigNumber
  tokenReserve: BigNumber
  exchangeRate: BigNumber // the zero slippage exchange rate
  totalContribution: BigNumber
  userContribution: BigNumber
  contributionPercentage: BigNumber
}

export type Rates = {
  expectedAmount: BigNumber // in human amounts (with decimals)
  slippage: BigNumber // in percentage points
}

export type WalletProvider = Omit<
  Zilliqa & { wallet: Wallet & { net: string; defaultAccount: { base16: string; bech32: string } } }, // ugly hack for zilpay non-standard API
  'subscriptionBuilder'
>

type RPCBalanceResponse = { balance: string; nonce: string }

export class Zilswap {
  /* Internals */
  private readonly zilliqa: Zilliqa // zilliqa sdk
  private readonly walletProvider?: WalletProvider // zilpay
  private readonly tokens: { [key in string]: string } // symbol => hash mappings
  private appState?: AppState // cached blockchain state for dApp and user

  /* Txn observers */
  private subscription: NewEventSubscription | null = null
  private observer: OnUpdate | null = null
  private observerMutex: Mutex
  private observedTxs: ObservedTx[] = []

  /* Deadline tracking */
  private deadlineBuffer: number = 10
  private currentBlock: number = -1

  /* Zilswap contract attributes */
  readonly contract: Contract
  readonly contractAddress: string
  readonly contractHash: string

  /* Transaction attributes */
  readonly _txParams: TxParams = {
    version: -1,
    gasPrice: new BN(0),
    gasLimit: Long.fromNumber(5000),
  }

  /**
   * Creates the Zilswap SDK object. {@linkcode initalize} needs to be called after
   * the object is created to begin watching the blockchain's state.
   *
   * @param network the Network to use, either `TestNet` or `MainNet`.
   * @param walletProviderOrKey a Provider with Wallet or private key string to be used for signing txns.
   * @param options a set of Options that will be used for all txns.
   */
  constructor(readonly network: Network, walletProviderOrKey?: WalletProvider | string, options?: Options) {
    if (typeof walletProviderOrKey === 'string') {
      this.zilliqa = new Zilliqa(APIS[network])
      this.zilliqa.wallet.addByPrivateKey(walletProviderOrKey)
    } else if (walletProviderOrKey) {
      this.zilliqa = new Zilliqa(APIS[network], walletProviderOrKey.provider)
      this.walletProvider = walletProviderOrKey
    } else {
      this.zilliqa = new Zilliqa(APIS[network])
    }

    this.contractAddress = CONTRACTS[network]
    this.contract = (this.walletProvider || this.zilliqa).contracts.at(this.contractAddress)
    this.contractHash = fromBech32Address(this.contractAddress).toLowerCase()
    this.tokens = {}
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
  public async initialize(subscription?: OnUpdate, observeTxs: ObservedTx[] = []) {
    this.observedTxs = observeTxs
    if (subscription) this.observer = subscription
    if (this._txParams.gasPrice.isZero()) {
      const minGasPrice = await this.zilliqa.blockchain.getMinimumGasPrice()
      if (!minGasPrice.result) throw new Error('Failed to get min gas price.')
      this._txParams.gasPrice = new BN(minGasPrice.result)
    }
    this.subscribeToAppChanges()
    await this.loadTokenList()
    await this.updateBlockHeight()
    await this.updateAppState()
    await this.updateBalanceAndNonce()
  }

  /**
   * Stops watching the Zilswap contract state.
   */
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

  /**
   * Gets the latest Zilswap app state.
   */
  public getAppState(): AppState {
    if (!this.appState) {
      throw new Error('App state not loaded, call #initialize first.')
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
      throw new Error('App state not loaded, call #initialize first.')
    }
    return this.appState.pools[this.getTokenAddresses(tokenID).hash] || null
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

  /**
   * Converts an amount to it's human representation (with decimals based on token contract, or 12 decimals for ZIL)
   * from it's unitless representation (integer, no decimals).
   * @param tokenID is the token ID related to the conversion amount, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param amountStr is the unitless amount as a string (e.g. 42000000000000 for 42 ZILs) to be converted.
   */
  public toUnit(tokenID: string, amountStr: string): string {
    const token = this.getTokenDetails(tokenID)
    const amountBN = new BigNumber(amountStr)
    if (!amountBN.integerValue().isEqualTo(amountStr)) {
      throw new Error(`Amount ${amountStr} for ${token.symbol} cannot have decimals.`)
    }
    return amountBN.shiftedBy(-token.decimals).toString()
  }

  /**
   * Gets the expected output amount and slippage for a particular set of ZRC-2 or ZIL tokens at the given input amount.
   *
   * @param tokenInID is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutID is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenInAmountStr is the exact amount of tokens to be sent to Zilswap as a unitless representable string (without decimals).
   */
  public getRatesForInput(tokenInID: string, tokenOutID: string, tokenInAmountStr: string): Rates {
    const tokenIn = this.getTokenDetails(tokenInID)
    const tokenOut = this.getTokenDetails(tokenOutID)
    const tokenInAmount = unitlessBigNumber(tokenInAmountStr)
    const { epsilonOutput, expectedOutput } = this.getOutputs(tokenIn, tokenOut, tokenInAmount)

    return {
      expectedAmount: expectedOutput,
      slippage: epsilonOutput.minus(expectedOutput).times(100).dividedBy(epsilonOutput).minus(0.3),
    }
  }

  /**
   * Gets the expected input amount and slippage for a particular set of ZRC-2 or ZIL tokens at the given output amount.
   * Returns NaN values if the given output amount is larger than the pool reserve.
   *
   * @param tokenInID is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutID is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutAmountStr is the exact amount of tokens to be received from Zilswap as a unitless representable string (without decimals).
   */
  public getRatesForOutput(tokenInID: string, tokenOutID: string, tokenOutAmountStr: string): Rates {
    const tokenIn = this.getTokenDetails(tokenInID)
    const tokenOut = this.getTokenDetails(tokenOutID)
    const tokenOutAmount = unitlessBigNumber(tokenOutAmountStr)
    const { epsilonInput, expectedInput } = this.getInputs(tokenIn, tokenOut, tokenOutAmount)

    return {
      expectedAmount: expectedInput,
      slippage: expectedInput.minus(epsilonInput).times(100).dividedBy(expectedInput).minus(0.3),
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
   * Adds a token which is not already loaded by the default tokens file to the SDK.
   * @param tokenAddress is the token address in base16 (0x...) or bech32 (zil...) form.
   *
   * @returns true if the token could be found, or false otherwise.
   */
  public async addToken(tokenAddress: string): Promise<boolean> {
    if (!this.appState) {
      throw new Error('App state not loaded, call #initialize first.')
    }
    try {
      const details = await this.fetchTokenDetails(tokenAddress)
      this.appState!.tokens[details.hash] = details
      return true
    } catch {
      return false
    }
  }

  /**
   * Approves allowing the Zilswap contract to transfer ZRC-2 token with `tokenID`, if the current
   * approved allowance is less than `amount`. If the allowance is sufficient, this method is a no-op.
   *
   * The approval is done by calling `IncreaseAllowance` with the allowance amount as the entire
   * token supply. This is done so that the approval needs to only be done once per token contract,
   * reducing the number of approval transactions required for users conducting multiple swaps.
   *
   * Non-custodial control of the token is ensured by the Zilswap contract itself, which does not
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
   *
   * @returns an ObservedTx if IncreaseAllowance was called, null if not.
   */
  public async approveTokenTransferIfRequired(tokenID: string, amountStrOrBN: BigNumber | string): Promise<ObservedTx | null> {
    // Check logged in
    this.checkAppLoadedWithUser()

    const token = this.getTokenDetails(tokenID)
    const tokenState = await token.contract.getState()
    const allowances = tokenState.allowances || tokenState.allowances_map
    const userAllowances = allowances[this.appState!.currentUser!] || {}
    const allowance = new BigNumber(userAllowances[this.contractHash] || 0)
    const amount: BigNumber = typeof amountStrOrBN === 'string' ? unitlessBigNumber(amountStrOrBN) : amountStrOrBN

    if (allowance.lt(amount)) {
      try {
        console.log('sending increase allowance txn..')
        const approveTxn = await this.callContract(
          token.contract,
          'IncreaseAllowance',
          [
            {
              vname: 'spender',
              type: 'ByStr20',
              value: this.contractHash,
            },
            {
              vname: 'amount',
              type: 'Uint128',
              value: new BigNumber(2).pow(128).minus(1).minus(allowance).toString(),
            },
          ],
          {
            amount: new BN(0),
            ...this.txParams(),
          },
          true
        )

        const observeTxn = {
          hash: approveTxn.id!,
          deadline: this.deadlineBlock(),
        }
        await this.observeTx(observeTxn)

        return observeTxn
      } catch (err) {
        if (err.message === 'Could not get balance') {
          throw new Error('No ZIL to pay for transaction.')
        } else {
          throw err
        }
      }
    }

    return null
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
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   *
   * Note that all amounts should be given with decimals in it's human represented form, rather than as a unitless integer.
   *
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @param zilsToAddStr is the exact amount of zilliqas to contribute to the pool in ZILs as a unitless string.
   * @param tokensToAddStr is the target amount of tokens to contribute to the pool as a unitless string.
   * @param maxExchangeRateChange is the maximum allowed exchange rate flucuation
   * given in {@link https://www.investopedia.com/terms/b/basispoint.asp basis points}. Defaults to 200 = 2.00% if not provided.
   */
  public async addLiquidity(
    tokenID: string,
    zilsToAddStr: string,
    tokensToAddStr: string,
    maxExchangeRateChange: number = 200
  ): Promise<ObservedTx> {
    // Check logged in
    this.checkAppLoadedWithUser()

    // Format token amounts
    const token = this.getTokenDetails(tokenID)
    const zil = this.getTokenDetails(ZIL_HASH)
    const tokensToAdd = new BigNumber(tokensToAddStr)
    const zilsToAdd = new BigNumber(zilsToAddStr)

    // Calculate allowances
    const pool = this.getPool(token.hash)
    const maxTokens = pool ? tokensToAdd.times(BASIS + maxExchangeRateChange).dividedToIntegerBy(BASIS) : tokensToAdd
    let minContribution = new BN(0)
    if (pool) {
      // sqrt(delta) * x = max allowed change in zil reserve
      // min contribution = zil added / max zil reserve * current total contributions
      const { zilReserve } = pool
      this.validateMaxExchangeRateChange(maxExchangeRateChange)
      const totalContribution = pool.totalContribution
      const numerator = totalContribution.times(zilsToAdd.toString())
      const denominator = new BigNumber(BASIS).plus(maxExchangeRateChange).sqrt().times(zilReserve.toString())
      minContribution = new BN(numerator.dividedToIntegerBy(denominator).toString())
    }

    // Check balances
    await this.checkAllowedBalance(token, tokensToAdd)
    await this.checkAllowedBalance(zil, zilsToAdd)

    const deadline = this.deadlineBlock()

    console.log('sending add liquidity txn..')
    const addLiquidityTxn = await this.callContract(
      this.contract,
      'AddLiquidity',
      [
        {
          vname: 'token_address',
          type: 'ByStr20',
          value: token.hash,
        },
        {
          vname: 'min_contribution_amount',
          type: 'Uint128',
          value: minContribution.toString(),
        },
        {
          vname: 'max_token_amount',
          type: 'Uint128',
          value: maxTokens.toString(),
        },
        {
          vname: 'deadline_block',
          type: 'BNum',
          value: deadline.toString(),
        },
      ],
      {
        amount: new BN(zilsToAdd.toString()), // _amount
        ...this.txParams(),
      },
      true
    )

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
   * Removes `contributionAmount` worth of liquidity from the pool with the given `tokenID`.
   *
   * The current user's contribution can be fetched in {@linkcode getPool}, and the expected returned amounts at the
   * current prevailing exchange rates can be calculated by prorating the liquidity pool reserves by the fraction of
   * the user's current contribution against the pool's total contribution.
   *
   * The maximum fluctuation in exchange rate from the given parameters can be controlled through `maxExchangeRateChange`,
   * to protect against changes in pool reserves between the txn submission and txn confirmation on the Zilliqa blockchain.
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   *
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @param contributionAmount is the exact amount of zilliqas to contribute to the pool in ZILs as a string.
   * @param maxExchangeRateChange is the maximum allowed exchange rate flucuation
   * given in {@link https://www.investopedia.com/terms/b/basispoint.asp basis points}. Defaults to 200 = 2.00% if not provided.
   */
  public async removeLiquidity(tokenID: string, contributionAmount: string, maxExchangeRateChange: number = 200): Promise<ObservedTx> {
    // Check logged in
    this.checkAppLoadedWithUser()

    // Check parameters
    this.validateMaxExchangeRateChange(maxExchangeRateChange)

    // Calculate contribution
    const token = this.getTokenDetails(tokenID)
    const pool = this.getPool(token.hash)
    if (!pool) {
      throw new Error('Pool not found.')
    }

    const { zilReserve, tokenReserve, userContribution, contributionPercentage } = pool
    // expected = reserve * (contributionPercentage / 100) * (contributionAmount / userContribution)
    const expectedZilAmount = zilReserve.times(contributionPercentage).times(contributionAmount).dividedBy(userContribution.times(100))
    const expectedTokenAmount = tokenReserve.times(contributionPercentage).times(contributionAmount).dividedBy(userContribution.times(100))
    const minZilAmount = expectedZilAmount.times(BASIS).dividedToIntegerBy(BASIS + maxExchangeRateChange)
    const minTokenAmount = expectedTokenAmount.times(BASIS).dividedToIntegerBy(BASIS + maxExchangeRateChange)

    // Check contribution
    if (userContribution.lt(contributionAmount)) {
      throw new Error('Trying to remove more contribution than available.')
    }

    const deadline = this.deadlineBlock()

    console.log('sending remove liquidity txn..')
    const removeLiquidityTxn = await this.callContract(
      this.contract,
      'RemoveLiquidity',
      [
        {
          vname: 'token_address',
          type: 'ByStr20',
          value: token.hash,
        },
        {
          vname: 'contribution_amount',
          type: 'Uint128',
          value: contributionAmount,
        },
        {
          vname: 'min_zil_amount',
          type: 'Uint128',
          value: minZilAmount.toString(),
        },
        {
          vname: 'min_token_amount',
          type: 'Uint128',
          value: minTokenAmount.toString(),
        },
        {
          vname: 'deadline_block',
          type: 'BNum',
          value: deadline.toString(),
        },
      ],
      {
        amount: new BN(0),
        ...this.txParams(),
      },
      true
    )

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
   * Swaps ZIL or a ZRC-2 token with `tokenInID` for a corresponding ZIL or ZRC-2 token with `tokenOutID`.
   *
   * The exact amount of ZIL or ZRC-2 to be sent in (sold) is `tokenInAmountHuman`. The amount received is determined by the prevailing
   * exchange rate at the current AppState. The expected amount to be received can be given fetched by getExpectedOutput (NYI).
   *
   * The maximum additional slippage incurred due to fluctuations in exchange rate from when the
   * transaction is signed and when it is processed by the Zilliqa blockchain can be bounded by the
   * `maxAdditionalSlippage` variable.
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   *
   * @param tokenInID is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutID is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenInAmountStr is the exact amount of tokens to be sent to Zilswap as a unitless string (without decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to constant product formula) that the
   * transition will allow before reverting.
   * @param recipientAddress is an optional recipient address for receiving the output of the swap in base16 (0x...) or bech32 (zil...).
   * Defaults to the sender address if `null` or undefined.
   */
  public async swapWithExactInput(
    tokenInID: string,
    tokenOutID: string,
    tokenInAmountStr: string,
    maxAdditionalSlippage: number = 200,
    recipientAddress: string | null = null
  ): Promise<ObservedTx> {
    this.checkAppLoadedWithUser()

    const tokenIn = this.getTokenDetails(tokenInID)
    const tokenOut = this.getTokenDetails(tokenOutID)
    const tokenInAmount = unitlessBigNumber(tokenInAmountStr)
    const { expectedOutput } = this.getOutputs(tokenIn, tokenOut, tokenInAmount)
    const minimumOutput = expectedOutput.times(BASIS).dividedToIntegerBy(BASIS + maxAdditionalSlippage)
    const parsedRecipientAddress = this.parseRecipientAddress(recipientAddress)

    await this.checkAllowedBalance(tokenIn, tokenInAmount)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (tokenIn.hash === ZIL_HASH) {
      // zil to zrc2
      txn = {
        transition: 'SwapExactZILForTokens',
        args: [
          {
            vname: 'token_address',
            type: 'ByStr20',
            value: tokenOut.hash,
          },
          {
            vname: 'min_token_amount',
            type: 'Uint128',
            value: minimumOutput.toString(),
          },
          {
            vname: 'deadline_block',
            type: 'BNum',
            value: deadline.toString(),
          },
          {
            vname: 'recipient_address',
            type: 'ByStr20',
            value: parsedRecipientAddress,
          },
        ],
        params: {
          amount: new BN(tokenInAmount.toString()),
          ...this.txParams(),
        },
      }
    } else if (tokenOut.hash === ZIL_HASH) {
      // zrc2 to zil
      txn = {
        transition: 'SwapExactTokensForZIL',
        args: [
          {
            vname: 'token_address',
            type: 'ByStr20',
            value: tokenIn.hash,
          },
          {
            vname: 'token_amount',
            type: 'Uint128',
            value: tokenInAmount.toString(),
          },
          {
            vname: 'min_zil_amount',
            type: 'Uint128',
            value: minimumOutput.toString(),
          },
          {
            vname: 'deadline_block',
            type: 'BNum',
            value: deadline.toString(),
          },
          {
            vname: 'recipient_address',
            type: 'ByStr20',
            value: parsedRecipientAddress,
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams(),
        },
      }
    } else {
      // zrc2 to zrc2
      txn = {
        transition: 'SwapExactTokensForTokens',
        args: [
          {
            vname: 'token0_address',
            type: 'ByStr20',
            value: tokenIn.hash,
          },
          {
            vname: 'token1_address',
            type: 'ByStr20',
            value: tokenOut.hash,
          },
          {
            vname: 'token0_amount',
            type: 'Uint128',
            value: tokenInAmount.toString(),
          },
          {
            vname: 'min_token1_amount',
            type: 'Uint128',
            value: minimumOutput.toString(),
          },
          {
            vname: 'deadline_block',
            type: 'BNum',
            value: deadline.toString(),
          },
          {
            vname: 'recipient_address',
            type: 'ByStr20',
            value: parsedRecipientAddress,
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams(),
        },
      }
    }

    console.log('sending swap txn..')
    const swapTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)

    if (swapTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**
   * Swaps ZIL or a ZRC-2 token with `tokenInID` for a corresponding ZIL or ZRC-2 token with `tokenOutID`.
   *
   * The exact amount of ZIL or ZRC-2 to be received (bought) is `tokenOutAmountHuman`. The amount sent is determined by the prevailing
   * exchange rate at the current AppState. The expected amount to be sent can be given fetched by getExpectedInput (NYI).
   *
   * The maximum additional slippage incurred due to fluctuations in exchange rate from when the
   * transaction is signed and when it is processed by the Zilliqa blockchain can be bounded by the
   * `maxAdditionalSlippage` variable.
   *
   * The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.
   *
   * @param tokenInID is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutID is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutAmountStr is the exact amount of tokens to be received from Zilswap as a unitless string (withoout decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to constant product formula) that the
   * transition will allow before reverting.
   * @param recipientAddress is an optional recipient address for receiving the output of the swap in base16 (0x...) or bech32 (zil...).
   * Defaults to the sender address if `null` or undefined.
   */
  public async swapWithExactOutput(
    tokenInID: string,
    tokenOutID: string,
    tokenOutAmountStr: string,
    maxAdditionalSlippage: number = 200,
    recipientAddress: string | null = null
  ): Promise<ObservedTx> {
    this.checkAppLoadedWithUser()

    const tokenIn = this.getTokenDetails(tokenInID)
    const tokenOut = this.getTokenDetails(tokenOutID)
    const tokenOutAmount = unitlessBigNumber(tokenOutAmountStr)
    const { expectedInput } = this.getInputs(tokenIn, tokenOut, tokenOutAmount)
    const maximumInput = expectedInput.times(BASIS + maxAdditionalSlippage).dividedToIntegerBy(BASIS)
    const parsedRecipientAddress = this.parseRecipientAddress(recipientAddress)

    await this.checkAllowedBalance(tokenIn, maximumInput)

    const deadline = this.deadlineBlock()

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (tokenIn.hash === ZIL_HASH) {
      // zil to zrc2
      txn = {
        transition: 'SwapZILForExactTokens',
        args: [
          {
            vname: 'token_address',
            type: 'ByStr20',
            value: tokenOut.hash,
          },
          {
            vname: 'token_amount',
            type: 'Uint128',
            value: tokenOutAmount.toString(),
          },
          {
            vname: 'deadline_block',
            type: 'BNum',
            value: deadline.toString(),
          },
          {
            vname: 'recipient_address',
            type: 'ByStr20',
            value: parsedRecipientAddress,
          },
        ],
        params: {
          amount: new BN(maximumInput.toString()),
          ...this.txParams(),
        },
      }
    } else if (tokenOut.hash === ZIL_HASH) {
      // zrc2 to zil
      txn = {
        transition: 'SwapTokensForExactZIL',
        args: [
          {
            vname: 'token_address',
            type: 'ByStr20',
            value: tokenIn.hash,
          },
          {
            vname: 'max_token_amount',
            type: 'Uint128',
            value: maximumInput.toString(),
          },
          {
            vname: 'zil_amount',
            type: 'Uint128',
            value: tokenOutAmount.toString(),
          },
          {
            vname: 'deadline_block',
            type: 'BNum',
            value: deadline.toString(),
          },
          {
            vname: 'recipient_address',
            type: 'ByStr20',
            value: parsedRecipientAddress,
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams(),
        },
      }
    } else {
      // zrc2 to zrc2
      txn = {
        transition: 'SwapTokensForExactTokens',
        args: [
          {
            vname: 'token0_address',
            type: 'ByStr20',
            value: tokenIn.hash,
          },
          {
            vname: 'token1_address',
            type: 'ByStr20',
            value: tokenOut.hash,
          },
          {
            vname: 'max_token0_amount',
            type: 'Uint128',
            value: maximumInput.toString(),
          },
          {
            vname: 'token1_amount',
            type: 'Uint128',
            value: tokenOutAmount.toString(),
          },
          {
            vname: 'deadline_block',
            type: 'BNum',
            value: deadline.toString(),
          },
          {
            vname: 'recipient_address',
            type: 'ByStr20',
            value: parsedRecipientAddress,
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams(),
        },
      }
    }

    console.log('sending swap txn..')
    const swapTxn = await this.callContract(this.contract, txn.transition, txn.args, txn.params, true)

    if (swapTxn.isRejected()) {
      throw new Error('Submitted transaction was rejected.')
    }

    const observeTxn = {
      hash: swapTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  private getInputs(
    tokenIn: TokenDetails,
    tokenOut: TokenDetails,
    tokenOutAmount: BigNumber
  ): { epsilonInput: BigNumber; expectedInput: BigNumber } {
    let expectedInput: BigNumber // the expected amount after slippage and fees
    let epsilonInput: BigNumber // the zero slippage input

    if (tokenIn.hash === ZIL_HASH) {
      // zil to zrc2
      const { zilReserve, tokenReserve } = this.getReserves(tokenOut)
      epsilonInput = tokenOutAmount.times(zilReserve).dividedToIntegerBy(tokenReserve)
      expectedInput = this.getInputFor(tokenOutAmount, zilReserve, tokenReserve)
    } else if (tokenOut.hash === ZIL_HASH) {
      // zrc2 to zil
      const { zilReserve, tokenReserve } = this.getReserves(tokenIn)
      epsilonInput = tokenOutAmount.times(tokenReserve).dividedToIntegerBy(zilReserve)
      expectedInput = this.getInputFor(tokenOutAmount, tokenReserve, zilReserve)
    } else {
      // zrc2 to zrc2
      const { zilReserve: zr1, tokenReserve: tr1 } = this.getReserves(tokenOut)
      const intermediateEpsilonInput = tokenOutAmount.times(zr1).dividedToIntegerBy(tr1)
      const intermediateInput = this.getInputFor(tokenOutAmount, zr1, tr1)

      const { zilReserve: zr2, tokenReserve: tr2 } = this.getReserves(tokenIn)
      epsilonInput = intermediateEpsilonInput.times(tr2).dividedToIntegerBy(zr2)
      expectedInput = this.getInputFor(intermediateInput, tr2, zr2)
    }

    return { epsilonInput, expectedInput }
  }

  private getOutputs(
    tokenIn: TokenDetails,
    tokenOut: TokenDetails,
    tokenInAmount: BigNumber
  ): { epsilonOutput: BigNumber; expectedOutput: BigNumber } {
    let epsilonOutput: BigNumber // the zero slippage output
    let expectedOutput: BigNumber // the expected amount after slippage and fees

    if (tokenIn.hash === ZIL_HASH) {
      // zil to zrc2
      const { zilReserve, tokenReserve } = this.getReserves(tokenOut)
      epsilonOutput = tokenInAmount.times(tokenReserve).dividedToIntegerBy(zilReserve)
      expectedOutput = this.getOutputFor(tokenInAmount, zilReserve, tokenReserve)
    } else if (tokenOut.hash === ZIL_HASH) {
      // zrc2 to zil
      const { zilReserve, tokenReserve } = this.getReserves(tokenIn)
      epsilonOutput = tokenInAmount.times(zilReserve).dividedToIntegerBy(tokenReserve)
      expectedOutput = this.getOutputFor(tokenInAmount, tokenReserve, zilReserve)
    } else {
      // zrc2 to zrc2
      const { zilReserve: zr1, tokenReserve: tr1 } = this.getReserves(tokenIn)
      const intermediateEpsilonOutput = tokenInAmount.times(zr1).dividedToIntegerBy(tr1)
      const intermediateOutput = this.getOutputFor(tokenInAmount, tr1, zr1)

      const { zilReserve: zr2, tokenReserve: tr2 } = this.getReserves(tokenOut)
      epsilonOutput = intermediateEpsilonOutput.times(tr2).dividedToIntegerBy(zr2)
      expectedOutput = this.getOutputFor(intermediateOutput, zr2, tr2)
    }

    return { epsilonOutput, expectedOutput }
  }

  private getInputFor(outputAmount: BigNumber, inputReserve: BigNumber, outputReserve: BigNumber): BigNumber {
    if (inputReserve.isZero() || outputReserve.isZero()) {
      throw new Error('Reserve has 0 tokens.')
    }
    if (outputReserve.lte(outputAmount)) {
      return new BigNumber('NaN')
    }
    const numerator = inputReserve.times(outputAmount).times(10000)
    const denominator = outputReserve.minus(outputAmount).times(this.getAfterFeeBps())
    return numerator.dividedToIntegerBy(denominator).plus(1)
  }

  private getOutputFor(inputAmount: BigNumber, inputReserve: BigNumber, outputReserve: BigNumber): BigNumber {
    if (inputReserve.isZero() || outputReserve.isZero()) {
      throw new Error('Reserve has 0 tokens.')
    }
    const inputAfterFee = inputAmount.times(this.getAfterFeeBps())
    const numerator = inputAfterFee.times(outputReserve)
    const denominator = inputReserve.times(10000).plus(inputAfterFee)
    return numerator.dividedToIntegerBy(denominator)
  }

  private getAfterFeeBps(): string {
    return this.getAppState().contractState.output_after_fee
  }

  private getReserves(token: TokenDetails) {
    const pool = this.getPool(token.hash)

    if (!pool) {
      return {
        zilReserve: new BigNumber(0),
        tokenReserve: new BigNumber(0),
      }
    }

    const { zilReserve, tokenReserve } = pool
    return { zilReserve, tokenReserve }
  }

  private async callContract(
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

  private subscribeToAppChanges() {
    const subscription = this.zilliqa.subscriptionBuilder.buildEventLogSubscriptions(WSS[this.network], {
      addresses: [this.contractHash],
    })

    subscription.subscribe({ query: MessageType.NEW_BLOCK })

    subscription.emitter.on(StatusType.SUBSCRIBE_EVENT_LOG, event => {
      console.log('ws connected: ', event)
    })

    subscription.emitter.on(MessageType.NEW_BLOCK, event => {
      // console.log('ws new block: ', JSON.stringify(event, null, 2))
      this.updateBlockHeight().then(() => this.updateObservedTxs())
    })

    subscription.emitter.on(MessageType.EVENT_LOG, event => {
      if (!event.value) return
      // console.log('ws update: ', JSON.stringify(event, null, 2))
      this.updateAppState()
    })

    subscription.emitter.on(MessageType.UNSUBSCRIBE, event => {
      console.log('ws disconnected: ', event)
      this.subscription = null
    })

    subscription.start()

    this.subscription = subscription
  }

  private async loadTokenList() {
    const res = await fetch('https://raw.githubusercontent.com/Switcheo/zilswap-token-list/master/tokens.json')
    const tokens = await res.json()
    Object.keys(tokens[this.network]).forEach(key => (this.tokens[key] = tokens[this.network][key]))
  }

  private async updateBlockHeight(): Promise<void> {
    const response = await this.zilliqa.blockchain.getNumTxBlocks()
    const bNum = parseInt(response.result!, 10)
    this.currentBlock = bNum
  }

  private async updateAppState(): Promise<void> {
    // Get the contract state
    const contractState = (await this.contract.getState()) as ContractState

    // Get user address
    const currentUser = this.walletProvider
      ? // ugly hack for zilpay provider
        this.walletProvider.wallet.defaultAccount.base16.toLowerCase()
      : this.zilliqa.wallet.defaultAccount?.address?.toLowerCase() || null

    // Get id of tokens that have liquidity pools
    const poolTokenHashes = Object.keys(contractState.pools)
    const defaultTokenHashes = Object.values(this.tokens).map((bech32: string) => this.getTokenAddresses(bech32).hash)
    const tokenHashes = poolTokenHashes.concat(defaultTokenHashes.filter((item: string) => poolTokenHashes.indexOf(item) < 0))

    // Get token details
    const tokens: { [key in string]: TokenDetails } = {}
    const promises = tokenHashes.map(async hash => {
      const d = await this.fetchTokenDetails(hash)
      tokens[hash] = d
    })
    await Promise.all(promises)

    // Get exchange rates
    const pools: { [key in string]: Pool } = {}
    tokenHashes.forEach(tokenHash => {
      if (!contractState.pools[tokenHash]) return

      const [x, y] = contractState.pools[tokenHash]!.arguments
      const zilReserve = new BigNumber(x)
      const tokenReserve = new BigNumber(y)
      const exchangeRate = zilReserve.dividedBy(tokenReserve)
      const totalContribution = new BigNumber(contractState.total_contributions[tokenHash]!)
      const poolBalances = contractState.balances[tokenHash]
      const userContribution = new BigNumber(poolBalances && currentUser ? poolBalances[currentUser] || 0 : 0)
      const contributionPercentage = userContribution.dividedBy(totalContribution).times(100)

      pools[tokenHash] = {
        zilReserve,
        tokenReserve,
        exchangeRate,
        totalContribution,
        userContribution,
        contributionPercentage,
      }
    })

    // Set new state
    this.appState = {
      contractState,
      tokens,
      pools,
      currentUser,
      currentNonce: this.appState?.currentNonce || null,
      currentBalance: this.appState?.currentBalance || null,
    }
  }

  private async updateBalanceAndNonce() {
    if (this.appState?.currentUser) {
      try {
        const res: RPCBalanceResponse = (await this.zilliqa.blockchain.getBalance(this.appState.currentUser)).result
        if (!res) {
          this.appState.currentBalance = new BigNumber(0)
          this.appState.currentNonce = 0
          return
        }
        this.appState.currentBalance = new BigNumber(res.balance)
        this.appState.currentNonce = parseInt(res.nonce, 10)
      } catch (err) {
        // ugly hack for zilpay non-standard API
        if (err.message === 'Account is not created') {
          this.appState.currentBalance = new BigNumber(0)
          this.appState.currentNonce = 0
        }
      }
    }
  }

  private async updateObservedTxs() {
    const release = await this.observerMutex.acquire()
    try {
      const removeTxs: string[] = []
      const promises = this.observedTxs.map(async (observedTx: ObservedTx) => {
        const result = await this.zilliqa.blockchain.getPendingTxn(observedTx.hash)
        if (result && result.confirmed) {
          // either confirmed or rejected
          const confirmedTxn = await this.zilliqa.blockchain.getTransaction(observedTx.hash)
          const receipt = confirmedTxn.getReceipt()
          const txStatus = confirmedTxn.isRejected() ? 'rejected' : receipt?.success ? 'confirmed' : 'rejected'
          if (this.observer) this.observer(observedTx, txStatus, receipt)
          removeTxs.push(observedTx.hash)
          return
        }
        if (observedTx.deadline < this.currentBlock) {
          // expired
          console.log(`tx deadline, current: ${observedTx.deadline}, ${this.currentBlock}`)
          if (this.observer) this.observer(observedTx, 'expired')
          removeTxs.push(observedTx.hash)
        }
      })

      await Promise.all(promises)

      this.observedTxs = this.observedTxs.filter((tx: ObservedTx) => !removeTxs.includes(tx.hash))

      await this.updateBalanceAndNonce()
    } finally {
      release()
    }
  }

  private parseRecipientAddress(addr: string | null): string {
    const address: string = addr === null ? this.getAppState().currentUser! : addr
    if (address.substr(0, 2) === '0x') {
      return address.toLowerCase()
    } else if (address.length === 32) {
      return `0x${address}`.toLowerCase()
    } else if (address.substr(0, 3) === 'zil') {
      return fromBech32Address(address).toLowerCase()
    } else {
      throw new Error('Invalid recipient address format!')
    }
  }

  private getTokenAddresses(id: string): { hash: string; address: string } {
    let hash, address

    if (id.substr(0, 2) === '0x') {
      hash = id.toLowerCase()
      address = toBech32Address(hash)
    } else if (id.substr(0, 3) === 'zil' && id.length > 3) {
      address = id
      hash = fromBech32Address(address).toLowerCase()
    } else {
      address = this.tokens[id]
      hash = fromBech32Address(address).toLowerCase()
    }

    return { hash, address }
  }

  private getTokenDetails(id: string): TokenDetails {
    const { hash } = this.getTokenAddresses(id)
    if (!this.appState) {
      throw new Error('App state not loaded, call #initialize first.')
    }
    if (!this.appState.tokens[hash]) {
      throw new Error(`Could not find token details for ${id}`)
    }
    return this.appState.tokens[hash]
  }

  private async fetchTokenDetails(id: string): Promise<TokenDetails> {
    const { hash, address } = this.getTokenAddresses(id)

    if (!!this.appState?.tokens[hash]) return this.appState.tokens[hash]

    const contract = (this.walletProvider || this.zilliqa).contracts.at(address)

    if (hash === ZIL_HASH) {
      return { contract, address, hash, symbol: 'ZIL', decimals: 12, whitelisted: true }
    }

    const init = await contract.getInit()

    const decimalStr = init.find((e: Value) => e.vname === 'decimals').value as string
    const decimals = parseInt(decimalStr, 10)
    const symbol = init.find((e: Value) => e.vname === 'symbol').value as string
    const whitelisted = this.tokens[symbol] === address

    return { contract, address, hash, symbol, decimals, whitelisted }
  }

  private async checkAllowedBalance(token: TokenDetails, amount: BigNumber) {
    // Check init
    this.checkAppLoadedWithUser()
    const user = this.appState!.currentUser!

    if (token.hash === ZIL_HASH) {
      // Check zil balance
      const zilBalance = this.appState!.currentBalance!
      if (zilBalance.lt(amount)) {
        throw new Error(`Insufficent ZIL in wallet.
        Required: ${this.toUnit(token.hash, amount.toString()).toString()},
        have: ${this.toUnit(token.hash, zilBalance.toString()).toString()}.`)
      }
    } else {
      // Check zrc-2 balance
      const tokenState = await token.contract.getState()
      const balances = tokenState.balances || tokenState.balances_map
      const tokenBalance = new BigNumber(balances[user] || 0)
      if (tokenBalance.lt(amount)) {
        throw new Error(`Insufficent tokens in wallet.
        Required: ${this.toUnit(token.hash, amount.toString()).toString()},
        have: ${this.toUnit(token.hash, tokenBalance.toString()).toString()}.`)
      }
      const allowances = tokenState.allowances || tokenState.allowances_map
      const userAllowances = allowances[user!] || {}
      const allowance = new BigNumber(userAllowances[this.contractHash] || 0)
      if (allowance.lt(amount)) {
        throw new Error(`Tokens need to be approved first.
        Required: ${this.toUnit(token.hash, amount.toString()).toString()},
        approved: ${this.toUnit(token.hash, allowance.toString()).toString()}.`)
      }
    }
  }

  private checkAppLoadedWithUser() {
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

  private txParams(): TxParams & { nonce: number } {
    return {
      nonce: this.nonce(),
      ...this._txParams,
    }
  }

  private deadlineBlock(): number {
    return this.currentBlock + this.deadlineBuffer!
  }

  private nonce(): number {
    return this.appState!.currentNonce! + this.observedTxs.length + 1
  }

  private validateMaxExchangeRateChange(maxExchangeRateChange: number) {
    if (maxExchangeRateChange % 1 !== 0 || maxExchangeRateChange >= BASIS || maxExchangeRateChange < 0) {
      throw new Error(`MaxExchangeRateChange ${maxExchangeRateChange} must be an integer between 0 and ${BASIS + 1}.`)
    }
  }
}

const unitlessBigNumber = (str: string): BigNumber => {
  const bn = new BigNumber(str)
  if (!bn.integerValue().isEqualTo(bn)) {
    throw new Error(`number ${bn} should be unitless (no decimals).`)
  }
  return bn
}
