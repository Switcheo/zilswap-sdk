import 'isomorphic-fetch'
import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Transaction, TxReceipt as _TxReceipt } from '@zilliqa-js/account'
import { Contract, Value, CallParams } from '@zilliqa-js/contract'
import { fromBech32Address } from '@zilliqa-js/crypto'
import { StatusType, MessageType, NewEventSubscription } from '@zilliqa-js/subscriptions'
import { BN, Long, units } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'
import { Mutex } from 'async-mutex'
import { isLocalStorageAvailable, toPositiveQa } from './utils'

import { WSS, ILO_STATE, ILO_CONTRACTS, CHAIN_VERSIONS, Network } from './constants'
import { Options, WalletProvider, Zilswap } from '.'

BigNumber.config({ EXPONENTIAL_AT: 1e9 }) // never!

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

export type ZiloContractState = {
  initialized: { [key in string]?: any }
  contributions: { [key in string]?: any }
  total_contributions: BigNumber
}

export type ZiloAppState = {
  contractState: ZiloContractState
  state: ILO_STATE
  claimable: boolean
  contributed: boolean
  currentNonce: number | null
  currentUser: string | null
  userContribution: BigNumber
}

type RPCBalanceResponse = { balance: string; nonce: string }

export class Zilo {
  /* Internals */
  private readonly zilliqa: Zilliqa
  private readonly walletProvider?: WalletProvider // zilpay
  private appState?: ZiloAppState

  /* Txn observers */
  private subscription: NewEventSubscription | null = null
  private observer: OnUpdate | null = null
  private observerMutex: Mutex
  private observedTxs: ObservedTx[] = []

  /* Deadline tracking */
  private deadlineBuffer: number = 10
  private currentBlock: number = -1

  /* Zilo contract attributes */
  readonly contract: Contract
  readonly contractAddress: string
  readonly contractHash: string

  /* Transaction attributes */
  readonly _txParams: TxParams = {
    version: -1,
    gasPrice: new BN(0),
    gasLimit: Long.fromNumber(5000),
  }

  constructor(readonly network: Network, walletProvider: WalletProvider | null, zilliqa: Zilliqa, options?: Options) {
    this.contractAddress = ILO_CONTRACTS[network]
    this.contract = (walletProvider || zilliqa).contracts.at(this.contractAddress)
    if (walletProvider) this.walletProvider = walletProvider
    this.contractHash = fromBech32Address(this.contractAddress).toLowerCase()
    this.observerMutex = new Mutex()
    this.zilliqa = zilliqa
    this._txParams.version = CHAIN_VERSIONS[network]

    if (options) {
      if (options.deadlineBuffer && options.deadlineBuffer > 0) this.deadlineBuffer = options.deadlineBuffer
      if (options.gasPrice && options.gasPrice > 0) this._txParams.gasPrice = toPositiveQa(options.gasPrice, units.Units.Li)
      if (options.gasLimit && options.gasLimit > 0) this._txParams.gasLimit = Long.fromNumber(options.gasLimit)
    }
  }

  public async initialize(subscription?: OnUpdate, observeTxs: ObservedTx[] = []) {
    this.observedTxs = observeTxs
    if (subscription) this.observer = subscription
    if (this._txParams.gasPrice.isZero()) {
      const minGasPrice = await this.zilliqa.blockchain.getMinimumGasPrice()
      if (!minGasPrice.result) throw new Error('Failed to get min gas price.')
      this._txParams.gasPrice = new BN(minGasPrice.result)
    }
    this.subscribeToAppChanges()
    await this.updateBlockHeight()
    await this.updateAppState()
    await this.updateNonce()
  }

  public async teardown() {
    if (this.subscription) {
      this.subscription.stop()
    }
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
  private async updateBlockHeight(): Promise<void> {
    const response = await this.zilliqa.blockchain.getNumTxBlocks()
    const bNum = parseInt(response.result!, 10)
    this.currentBlock = bNum
  }

  private async updateAppState(): Promise<void> {
    const currentUser = this.walletProvider
      ? // ugly hack for zilpay provider
        this.walletProvider.wallet.defaultAccount.base16.toLowerCase()
      : this.zilliqa.wallet.defaultAccount?.address?.toLowerCase() || null
    // Get the contract state
    const contractState = (await this.contract.getState()) as ZiloContractState
    const cont_state = await this.CheckStatus(contractState)
    const userContribution = contractState.contributions[currentUser || '']
    const claimable = cont_state === ILO_STATE.Completed && userContribution > 0
    const contributed = userContribution > 0

    // Set new state
    this.appState = {
      contractState,
      claimable,
      contributed,
      currentNonce: this.appState?.currentNonce || 0,
      currentUser,
      state: cont_state,
      userContribution,
    }
  }

  private async CheckStatus(contractState: ZiloContractState): Promise<ILO_STATE> {
    const init = await this.fetchContractInit()
    const endBlock = init.find((e: Value) => e.vname === 'end_block').value as number
    const startBlock = init.find((e: Value) => e.vname === 'start_block').value as number
    const minAmount = init.find((e: Value) => e.vname === 'minimum_zil_amount').value as BigNumber

    if (contractState.initialized['constructor'] === 'False' || !contractState.initialized) {
      return ILO_STATE.Uninitialized
    }

    if (this.currentBlock < startBlock) {
      return ILO_STATE.Pending
    }

    if (this.currentBlock < endBlock) {
      return ILO_STATE.Active
    }

    if (minAmount > contractState.total_contributions) {
      return ILO_STATE.Failed
    } else {
      return ILO_STATE.Completed
    }
  }

  private async updateNonce() {
    if (this.appState?.currentUser) {
      try {
        const res: RPCBalanceResponse = (await this.zilliqa.blockchain.getBalance(this.appState.currentUser)).result
        if (!res) {
          this.appState.currentNonce = 0
          return
        }
        this.appState.currentNonce = parseInt(res.nonce, 10)
      } catch (err) {
        // ugly hack for zilpay non-standard API
        if (err.message === 'Account is not created') {
          this.appState.currentNonce = 0
        }
      }
    }
  }

  public async claim(): Promise<ObservedTx | null> {
    // Check init
    this.checkAppLoadedWithUser()

    if (this.appState?.state !== ILO_STATE.Completed && this.appState?.state !== ILO_STATE.Failed) {
      throw new Error('Not yet claimable/refundable')
    }

    const claimTxn = await this.callContract(this.contract, 'Claim', [], { amount: new BN(0), ...this.txParams() }, true)

    if (claimTxn.isRejected()) {
      throw new Error('Claim transaction was rejected.')
    }

    const deadline = this.deadlineBlock()

    const observeTxn = {
      hash: claimTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  public async complete(): Promise<ObservedTx | null> {
    this.checkAppLoadedWithUser()

    const completeTxn = await this.callContract(this.contract, 'Complete', [], { amount: new BN(0), ...this.txParams() }, true)

    if (completeTxn.isRejected()) {
      throw new Error('Complete transaction was rejected.')
    }

    const deadline = this.deadlineBlock()

    const observeTxn = {
      hash: completeTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  /**


   * @param amountToContributeStr is the exact amount of tokens to be received from Zilswap as a unitless string (withoout decimals).
   */
  public async contribute(amountToContributeStr: string): Promise<ObservedTx | null> {
    // Check init
    const amountToContribute = new BigNumber(amountToContributeStr)
    this.checkAppLoadedWithUser()

    const contributeTxn = await this.callContract(
      this.contract,
      'Contribute',
      [],
      { amount: new BN(amountToContribute.toString()), ...this.txParams() },
      true
    )

    if (contributeTxn.isRejected()) {
      throw new Error('Contribute transaction was rejected.')
    }

    const deadline = this.deadlineBlock()

    const observeTxn = {
      hash: contributeTxn.id!,
      deadline,
    }
    await this.observeTx(observeTxn)

    return observeTxn
  }

  public getAppState(): ZiloAppState {
    if (!this.appState) {
      throw new Error('Zilo app state not loaded, call #initialize first.')
    }
    return this.appState
  }

  public async observeTx(observedTx: ObservedTx) {
    const release = await this.observerMutex.acquire()
    try {
      this.observedTxs.push(observedTx)
    } finally {
      release()
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

      await this.updateNonce()
    } finally {
      release()
    }
  }

  private async fetchContractInit(): Promise<any> {
    // try to use cache first
    const lsCacheKey = `contractInit:${this.contract.address!}`
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
      const init = await this.contract.getInit()
      if (isLocalStorageAvailable()) {
        localStorage.setItem(lsCacheKey, JSON.stringify(init))
      }
      return init
    } catch (error) {
      if (error?.message === 'Network request failed') {
        // make another fetch attempt after 800ms
        return this.fetchContractInit()
      } else {
        throw error
      }
    }
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
      console.log('ilo ws connected: ', event)
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
}
