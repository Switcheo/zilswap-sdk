import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Provider } from '@zilliqa-js/core'
import { TxReceipt } from '@zilliqa-js/account'
import { Contract, Value, CallParams } from '@zilliqa-js/contract'
import { fromBech32Address, toBech32Address } from '@zilliqa-js/crypto'
import { StatusType, MessageType, NewEventSubscription } from '@zilliqa-js/subscriptions'

import { BN, Long, units } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'

import { APIS, WSS, CONTRACTS, TOKENS, CHAIN_VERSIONS, BASIS, Network, ZIL_HASH } from './constants'
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
    gasLimit: Long.fromNumber(10000),
  }

  /**
   * Creates the Zilswap SDK object. {@linkcode initalize} needs to be called after
   * the object is created to begin watching the blockchain's state.
   *
   * @param network the Network to use, either `TestNet` or `MainNet`.
   * @param providerOrKey a wallet Provider of private key string to be used for signing txns
   * @param options a set of Options that will be used for all txns
   */
  constructor(readonly network: Network, providerOrKey?: Provider | string, options?: Options) {
    if (typeof providerOrKey === 'string') {
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

  /**
   * Intializes the SDK, fetching a cache of the Zilswap contract state and
   * subscribing to subsequent state changes.
   */
  public async initialize() {
    this.subscribeToAppChanges()
    await this.updateAppState()
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
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @param amount is the required allowance amount the Zilswap contract requires, below which the
   * `IncreaseAllowance` transition is invoked. Note that this amount is specified with a BN as a
   * unit-less integer, and not a human string.
   *
   * @returns a transaction receipt if IncreaseAllowance was called, null if not.
   */
  public async approveTokenTransferIfRequired(tokenID: string, amount: BN): Promise<TxReceipt | null> {
    const token = await this.getTokenDetails(tokenID)
    const tokenState = await token.contract.getState()
    const allowance = new BN(tokenState.allowances_map[this.appState!.currentUser!][this.contractHash] || 0)

    if (allowance.lt(amount)) {
      console.log('sending increase allowance txn..')
      const approveTxn = await token.contract.call(
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
            value: tokenState.total_supply.toString(),
          },
        ],
        {
          amount: new BN(0),
          ...this.txParams,
        },
        undefined,
        undefined,
        true
      )
      const approveTxnReceipt = approveTxn.getReceipt()!
      // console.log(JSON.stringify(approveTxnReceipt, null, 4))

      return approveTxnReceipt
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
   * Note that all amounts should be given with decimals in it's human represented form, rather than as a unitless integer.
   *
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @param zilsToAddHuman is the exact amount of zilliqas to contribute to the pool in ZILs as a string.
   * @param tokensToAddHuman is the target amount of tokens to contribute to the pool with decimals as a string.
   * @param maxExchangeRateChange is the maximum allowed exchange rate flucuation
   * given in {@link https://www.investopedia.com/terms/b/basispoint.asp basis points}. Defaults to 200 = 2.00% if not provided.
   */
  public async addLiquidity(
    tokenID: string,
    zilsToAddHuman: string,
    tokensToAddHuman: string,
    maxExchangeRateChange: number = 200
  ): Promise<TxReceipt> {
    if (!this.appState) await this.updateAppState()

    // Check user address
    if (this.appState!.currentUser === null) {
      throw new Error('No wallet connected!')
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
      this.validateMaxExchangeRateChange(maxExchangeRateChange)
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
    const receiptOrNull = await this.approveTokenTransferIfRequired(tokenID, tokensToAdd)

    if (receiptOrNull !== null && !receiptOrNull.success) {
      throw new Error('Failed to approve token transfer!')
    }

    console.log('sending add liquidity txn..')
    const addLiquidityTxn = await this.contract.call(
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
          value: await this.deadlineBlock(),
        },
      ],
      {
        amount: zilsToAdd, // _amount
        ...this.txParams,
      },
      undefined,
      undefined,
      true
    )
    const addLiquidityTxnReceipt = addLiquidityTxn.getReceipt()!
    // console.log(JSON.stringify(addLiquidityTxnReceipt, null, 4))

    return addLiquidityTxnReceipt
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
   * @param tokenID is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...).
   * @param contributionAmount is the exact amount of zilliqas to contribute to the pool in ZILs as a string.
   * @param maxExchangeRateChange is the maximum allowed exchange rate flucuation
   * given in {@link https://www.investopedia.com/terms/b/basispoint.asp basis points}. Defaults to 200 = 2.00% if not provided.
   */
  public async removeLiquidity(tokenID: string, contributionAmount: string, maxExchangeRateChange: number = 200): Promise<TxReceipt> {
    if (!this.appState) await this.updateAppState()

    // Check user address
    if (this.appState!.currentUser === null) {
      throw new Error('No wallet connected!')
    }

    // Check parameters
    this.validateMaxExchangeRateChange(maxExchangeRateChange)

    // Calculate allowances
    const token = await this.getTokenDetails(tokenID)
    const pool = this.getPool(token.hash)
    if (!pool) {
      throw new Error('Pool not found!')
    }

    const { zilReserve, tokenReserve, userContribution, contributionPercentage } = pool
    // expected = reserve * (contributionPercentage / 100) * (contributionAmount / userContribution)
    const expectedZilAmount = zilReserve
      .shiftedBy(12)
      .times(contributionPercentage)
      .times(contributionAmount)
      .dividedBy(userContribution.times(100))
    const expectedTokenAmount = tokenReserve
      .shiftedBy(token.decimals)
      .times(contributionPercentage)
      .times(contributionAmount)
      .dividedBy(userContribution.times(100))
    const minZilAmount = expectedZilAmount.times(BASIS).dividedToIntegerBy(BASIS + maxExchangeRateChange)
    const minTokenAmount = expectedTokenAmount.times(BASIS).dividedToIntegerBy(BASIS + maxExchangeRateChange)
    // console.log(JSON.stringify({contributionPercentage, contributionAmount, userContribution, expectedZilAmount, expectedTokenAmount, minZilAmount, minTokenAmount}, null, 4))

    console.log('sending remove liquidity txn..')
    const removeLiquidityTxn = await this.contract.call(
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
          value: await this.deadlineBlock(),
        },
      ],
      {
        amount: new BN(0),
        ...this.txParams,
      },
      undefined,
      undefined,
      true
    )
    const removeLiquidityTxnReceipt = removeLiquidityTxn.getReceipt()!
    // console.log(JSON.stringify(removeLiquidityTxn, null, 4))

    return removeLiquidityTxnReceipt
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
   * @param tokenInID is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutID is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenInAmountHuman is the exact amount of tokens to be sent to Zilswap as human representable string (with decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to constant product formula) that the
   * transition will allow before reverting.
   */
  public async swapWithExactInput(
    tokenInID: string,
    tokenOutID: string,
    tokenInAmountHuman: string,
    maxAdditionalSlippage: number = 200
  ): Promise<TxReceipt> {
    const tokenIn = await this.getTokenDetails(tokenInID)
    const tokenOut = await this.getTokenDetails(tokenOutID)

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (tokenIn.hash === ZIL_HASH) {
      // zil to zrc2
      const { zilReserve, tokenReserve } = this.getRawReserves(tokenOut)
      const tokenInAmount = new BigNumber(tokenInAmountHuman).shiftedBy(12).integerValue()
      const expectedOutput = this.getOutputFor(tokenInAmount, zilReserve, tokenReserve)
      const minimumOutput = expectedOutput.times(BASIS).dividedToIntegerBy(BASIS + maxAdditionalSlippage)
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
            value: await this.deadlineBlock(),
          },
        ],
        params: {
          amount: new BN(tokenInAmount.toString()),
          ...this.txParams,
        },
      }
    } else if (tokenOut.hash === ZIL_HASH) {
      // zrc2 to zil
      const { zilReserve, tokenReserve } = this.getRawReserves(tokenIn)
      const tokenInAmount = new BigNumber(tokenInAmountHuman).shiftedBy(tokenIn.decimals).integerValue()
      const expectedOutput = this.getOutputFor(tokenInAmount, tokenReserve, zilReserve)
      const minimumOutput = expectedOutput.times(BASIS).dividedToIntegerBy(BASIS + maxAdditionalSlippage)

      const receiptOrNull = await this.approveTokenTransferIfRequired(tokenInID, new BN(tokenInAmount.toString()))
      if (receiptOrNull !== null && !receiptOrNull.success) {
        throw new Error('Failed to approve token transfer!')
      }

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
            value: await this.deadlineBlock(),
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams,
        },
      }
    } else {
      // zrc2 to zrc2
      const { zilReserve: zr1, tokenReserve: tr1 } = this.getRawReserves(tokenIn)
      const tokenInAmount = new BigNumber(tokenInAmountHuman).shiftedBy(tokenIn.decimals).integerValue()
      const intermediateOutput = this.getOutputFor(tokenInAmount, tr1, zr1)

      const { zilReserve: zr2, tokenReserve: tr2 } = this.getRawReserves(tokenOut)
      const expectedOutput = this.getOutputFor(intermediateOutput, zr2, tr2)
      const minimumOutput = expectedOutput.times(BASIS).dividedToIntegerBy(BASIS + maxAdditionalSlippage)

      const receiptOrNull = await this.approveTokenTransferIfRequired(tokenInID, new BN(tokenInAmount.toString()))
      if (receiptOrNull !== null && !receiptOrNull.success) {
        throw new Error('Failed to approve token transfer!')
      }

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
            value: await this.deadlineBlock(),
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams,
        },
      }
    }

    console.log('sending swap txn..')
    const swapTxn = await this.contract.call(txn.transition, txn.args, txn.params, undefined, undefined, true)

    const swapTxnReceipt = swapTxn.getReceipt()!
    // console.log(JSON.stringify(swapTxnReceipt, null, 4))

    return swapTxnReceipt
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
   * @param tokenInID is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenOutID is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts),
   * hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant.
   * @param tokenInAmountHuman is the exact amount of tokens to be received from Zilswap as human representable string (with decimals).
   * @param maxAdditionalSlippage is the maximum additional slippage (on top of slippage due to constant product formula) that the
   * transition will allow before reverting.
   */
  public async swapWithExactOutput(
    tokenInID: string,
    tokenOutID: string,
    tokenOutAmountHuman: string,
    maxAdditionalSlippage: number = 200
  ): Promise<TxReceipt> {
    const tokenIn = await this.getTokenDetails(tokenInID)
    const tokenOut = await this.getTokenDetails(tokenOutID)

    let txn: { transition: string; args: Value[]; params: CallParams }

    if (tokenIn.hash === ZIL_HASH) {
      // zil to zrc2
      const { zilReserve, tokenReserve } = this.getRawReserves(tokenOut)
      const tokenOutAmount = new BigNumber(tokenOutAmountHuman).shiftedBy(tokenOut.decimals).integerValue()
      const expectedInput = this.getInputFor(tokenOutAmount, zilReserve, tokenReserve)
      const maximumInput = expectedInput.times(BASIS + maxAdditionalSlippage).dividedToIntegerBy(BASIS)
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
            value: await this.deadlineBlock(),
          },
        ],
        params: {
          amount: new BN(maximumInput.toString()),
          ...this.txParams,
        },
      }
    } else if (tokenOut.hash === ZIL_HASH) {
      // zrc2 to zil
      const { zilReserve, tokenReserve } = this.getRawReserves(tokenIn)
      const tokenOutAmount = new BigNumber(tokenOutAmountHuman).shiftedBy(12).integerValue()
      const expectedInput = this.getInputFor(tokenOutAmount, tokenReserve, zilReserve)
      const maximumInput = expectedInput.times(BASIS + maxAdditionalSlippage).dividedToIntegerBy(BASIS)

      const receiptOrNull = await this.approveTokenTransferIfRequired(tokenInID, new BN(maximumInput.toString()))
      if (receiptOrNull !== null && !receiptOrNull.success) {
        throw new Error('Failed to approve token transfer!')
      }

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
            value: await this.deadlineBlock(),
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams,
        },
      }
    } else {
      // zrc2 to zrc2
      const { zilReserve: zr1, tokenReserve: tr1 } = this.getRawReserves(tokenOut)
      const tokenOutAmount = new BigNumber(tokenOutAmountHuman).shiftedBy(tokenOut.decimals).integerValue()
      const intermediateInput = this.getInputFor(tokenOutAmount, zr1, tr1)

      const { zilReserve: zr2, tokenReserve: tr2 } = this.getRawReserves(tokenIn)
      const expectedInput = this.getInputFor(intermediateInput, tr2, zr2)
      const maximumInput = expectedInput.times(BASIS + maxAdditionalSlippage).dividedToIntegerBy(BASIS)

      const receiptOrNull = await this.approveTokenTransferIfRequired(tokenInID, new BN(maximumInput.toString()))
      if (receiptOrNull !== null && !receiptOrNull.success) {
        throw new Error('Failed to approve token transfer!')
      }

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
            value: await this.deadlineBlock(),
          },
        ],
        params: {
          amount: new BN(0),
          ...this.txParams,
        },
      }
    }

    console.log('sending swap txn..')
    const swapTxn = await this.contract.call(txn.transition, txn.args, txn.params, undefined, undefined, true)

    const swapTxnReceipt = swapTxn.getReceipt()!
    // console.log(JSON.stringify(swapTxnReceipt, null, 4))

    return swapTxnReceipt
  }

  private getInputFor(outputAmount: BigNumber, inputReserve: BigNumber, outputReserve: BigNumber): BigNumber {
    if (inputReserve.isZero() || outputReserve.isZero()) {
      throw new Error('Reserve has 0 tokens!')
    }
    const numerator = inputReserve.times(outputAmount).times(1000)
    const denominator = outputReserve.minus(outputAmount).times(997)
    return numerator.dividedToIntegerBy(denominator).plus(1)
  }

  private getOutputFor(inputAmount: BigNumber, inputReserve: BigNumber, outputReserve: BigNumber): BigNumber {
    if (inputReserve.isZero() || outputReserve.isZero()) {
      throw new Error('Reserve has 0 tokens!')
    }
    const inputAfterFee = inputAmount.times(997)
    const numerator = inputAfterFee.times(outputReserve)
    const denominator = inputReserve.times(1000).plus(inputAfterFee)
    return numerator.dividedToIntegerBy(denominator)
  }

  private getRawReserves(token: TokenDetails) {
    const pool = this.getPool(token.hash)
    const { zilReserve, tokenReserve } = pool!
    return {
      zilReserve: zilReserve.shiftedBy(12),
      tokenReserve: tokenReserve.shiftedBy(token.decimals),
    }
  }

  private subscribeToAppChanges() {
    const subscription = this.zilliqa.subscriptionBuilder.buildEventLogSubscriptions(WSS[this.network], {
      addresses: [this.contractHash],
    })

    subscription.emitter.on(StatusType.SUBSCRIBE_EVENT_LOG, event => {
      console.log('ws connected: ', event)
    })

    subscription.emitter.on(MessageType.EVENT_LOG, event => {
      if (!event.value) return
      console.log('ws update: ', JSON.stringify(event))
      this.updateAppState()
    })

    subscription.emitter.on(MessageType.UNSUBSCRIBE, event => {
      console.log('ws disconnected: ', event)
      this.subscription = null
    })

    subscription.start()

    this.subscription = subscription
  }

  private async updateAppState(): Promise<void> {
    // Get the contract state
    const contractState = await this.contract.getState()

    // New app state
    const state: AppState = {
      contractState,
      currentUser: this.appState?.currentUser || null,
      tokens: this.appState?.tokens || {},
      pools: {},
    }

    // Get id of tokens that have liquidity pools
    const tokenHashes = Object.keys(contractState.pools)

    // Get token details
    const promises = tokenHashes.map(async hash => {
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

      state.pools[tokenHash] = {
        zilReserve,
        tokenReserve,
        exchangeRate,
        totalContribution,
        userContribution,
        contributionPercentage,
      }
    })

    // Set new state
    this.appState = state
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
      address = this.tokens[id.toUpperCase()]
      hash = fromBech32Address(address).toLowerCase()
    }

    return { hash, address }
  }

  private async getTokenDetails(id: string): Promise<TokenDetails> {
    const { hash, address } = this.getTokenAddresses(id)

    if (!!this.appState?.tokens[hash]) return this.appState.tokens[hash]

    const contract = this.zilliqa.contracts.at(address)

    if (hash === ZIL_HASH) {
      return { contract, address, hash, symbol: 'ZIL', decimals: 12 }
    }

    const init = await contract.getInit()

    const decimalStr = init.find((e: Value) => e.vname === 'decimals').value as string
    const decimals = parseInt(decimalStr, 10)
    const symbol = init.find((e: Value) => e.vname === 'symbol').value as string

    return { contract, address, hash, symbol, decimals }
  }

  private async deadlineBlock(): Promise<string> {
    const response = await this.zilliqa.blockchain.getNumTxBlocks()
    const bNum = parseInt(response.result!, 10)
    return (bNum + this.deadlineBuffer!).toString()
  }

  private validateMaxExchangeRateChange(maxExchangeRateChange: number) {
    if (maxExchangeRateChange % 1 !== 0 || maxExchangeRateChange >= BASIS || maxExchangeRateChange < 0) {
      throw new Error(`maxExchangeRateChange: ${maxExchangeRateChange} must be an integer between 0 and ${BASIS + 1}!`)
    }
  }
}

export { Zilswap }
