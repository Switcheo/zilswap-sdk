import { Contract, Value } from '@zilliqa-js/contract'
import { BN } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'
import { ObservedTx, Zilswap } from "./index"
import { ILOState } from './constants'
import { contractInitToMap, unitlessBigNumber } from './utils'

export type OnStateUpdate = (appState: ZiloAppState) => void

interface ADTValue {
  constructor: string
  argtypes: string[]
  arguments: Value[]
}

export type ZiloContractState = {
  initialized: ADTValue
  contributions: { [key in string]?: any }
  total_contributions: string
}

export type ZiloContractInit = {
  zwap_address: string
  token_address: string
  token_amount: string
  target_zil_amount: string
  target_zwap_amount: string
  minimum_zil_amount: string
  liquidity_zil_amount: string
  receiver_address: string
  liquidity_address: string
  start_block: string
  end_block: string
  _scilla_version: string
  _creation_block: string
  _this_address: string
}

export type ZiloAppState = {
  contractState: ZiloContractState
  state: ILOState
  claimable: boolean
  contributed: boolean
  currentNonce: number | null
  currentUser: string | null
  userContribution: string
  contractInit: ZiloContractInit | null
}

export class Zilo {

  private zilswap: Zilswap
  private contract: Contract
  private appState?: ZiloAppState

  private stateObserver: OnStateUpdate | null = null

  constructor(zilswap: Zilswap, address: string) {
    this.zilswap = zilswap
    this.contract = zilswap.zilliqa.contracts.at(address);
  }

  public async initialize(subscription?: OnStateUpdate) {
    if (subscription) this.stateObserver = subscription
    await this.zilswap.addToSubscription(this.contract.address!);
    await this.updateZiloState()
  }

  public async updateZiloState() {
    const contractState = (await this.contract.getState()) as ZiloContractState
    const stateOfContract = await this.checkStatus(contractState)

    const currentUser = this.zilswap.getAppState().currentUser;

    const userContribution = contractState.contributions[currentUser || ''] ?? 0
    const claimable = stateOfContract === ILOState.Completed && new BigNumber(userContribution).isPositive()
    const contributed = userContribution > 0
    let contractInit = this.appState?.contractInit || null

    if (!contractInit) {
      const result = await this.zilswap.fetchContractInit(this.contract)
      contractInit = contractInitToMap(result) as ZiloContractInit
    }

    let newState = {
      contractState,
      claimable,
      contributed,
      currentNonce: this.appState?.currentNonce || 0,
      currentUser,
      state: stateOfContract,
      userContribution,
      contractInit,
    }

    this.appState = newState
    if (this.stateObserver) {
      this.stateObserver(newState)
    }
  }

  public getZiloState(): ZiloAppState {
    if (!this.appState) {
      throw new Error('Zilo app state not loaded, call #initialize first.')
    }
    return this.appState
  }

  /**
   * Checks the state of the current contract
   * ILOState.Uninitialized = Contract deployed but not initialized
   * ILOState.Pending = Contract initialized not stated (current block < start block)
   * ILOState.Active = Contract started
   * ILOState.Failed = Contract ended but target amount not reached
   * ILOState.Completed = Contract ended and target amount fufilled
   *
   * @param contractState
   * @returns returns the current ILOState
   */
  private async checkStatus(contractState: ZiloContractState): Promise<ILOState> {
    const result = await this.zilswap.fetchContractInit(this.contract)
    const contractInit = contractInitToMap(result) as ZiloContractInit

    if (!result || contractState.initialized.constructor !== 'True') {
      return ILOState.Uninitialized
    }

    const currentBlock = this.zilswap.getCurrentBlock();

    if (currentBlock < parseInt(contractInit.start_block)) {
      return ILOState.Pending
    }

    if (currentBlock < parseInt(contractInit.end_block)) {
      return ILOState.Active
    }

    if (new BigNumber(contractInit.target_zil_amount).gt(new BigNumber(contractState.total_contributions))) {
      return ILOState.Failed
    } else {
      return ILOState.Completed
    }
  }

  /**
   * Execute claim function if user contributed
   */
  public async claim(): Promise<ObservedTx | null> {
    // Check init
    this.zilswap.checkAppLoadedWithUser()

    // check if current state is claimable
    if (this.appState?.state !== ILOState.Completed && this.appState?.state !== ILOState.Failed) {
      throw new Error('Not yet claimable/refundable')
    }

    // no contribution
    if (!this.appState?.contributed) {
      throw new Error('User did not contribute')
    }

    const claimTxn = await this.zilswap.callContract(this.contract, 'Claim', [], { amount: new BN(0), ...this.zilswap.txParams() }, true)

    if (claimTxn.isRejected()) {
      throw new Error('Claim transaction was rejected.')
    }

    const deadline = this.zilswap.deadlineBlock()

    const observeTxn = {
      hash: claimTxn.id!,
      deadline,
    }
    await this.zilswap.observeTx(observeTxn)

    return observeTxn
  }

  public async complete(): Promise<ObservedTx | null> {
    this.zilswap.checkAppLoadedWithUser()

    const completeTxn = await this.zilswap.callContract(this.contract, 'Complete', [], { amount: new BN(0), ...this.zilswap.txParams() }, true)

    if (completeTxn.isRejected()) {
      throw new Error('Complete transaction was rejected.')
    }

    const deadline = this.zilswap.deadlineBlock()

    const observeTxn = {
      hash: completeTxn.id!,
      deadline,
    }
    await this.zilswap.observeTx(observeTxn)

    return observeTxn
  }

  /**
 * Contribute to the ilo, may need to increase token allowance before proceeding
 *
 * @param amountToContributeStr is the exact amount of tokens to be received from Zilswap as a unitless string (withoout decimals).
 */
  public async contribute(amountToContributeStr: string): Promise<ObservedTx | null> {
    // Check init
    const amountToContribute = unitlessBigNumber(amountToContributeStr)
    this.zilswap.checkAppLoadedWithUser()

    const contributeTxn = await this.zilswap.callContract(
      this.contract,
      'Contribute',
      [],
      { amount: new BN(amountToContribute.toString()), ...this.zilswap.txParams() },
      true
    )

    if (contributeTxn.isRejected()) {
      throw new Error('Contribute transaction was rejected.')
    }

    const deadline = this.zilswap.deadlineBlock()

    const observeTxn = {
      hash: contributeTxn.id!,
      deadline,
    }
    await this.zilswap.observeTx(observeTxn)

    return observeTxn
  }
}
