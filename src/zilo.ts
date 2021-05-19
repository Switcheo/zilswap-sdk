import { Zilswap, ObservedTx } from "."
import { Contract, Value } from '@zilliqa-js/contract'
import { TxReceipt as _TxReceipt } from '@zilliqa-js/account'
import { BN } from '@zilliqa-js/util'
import { unitlessBigNumber } from './utils'
import { ILO_STATE } from './constants'
import { BigNumber } from 'bignumber.js'


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

export type ZiloAppState = {
  contractState: ZiloContractState
  state: ILO_STATE
  claimable: boolean
  contributed: boolean
  currentNonce: number | null
  currentUser: string | null
  userContribution: string
  contractInit: ContractInit | null
}

export type ContractInit = {
  _scilla_version: string
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
  _creation_block: string
  _this_address: string
}


export class Zilo {

  private zilswap: Zilswap
  private contract: Contract
  private contractHash: string
  private appState?: ZiloAppState

  private stateObserver: OnStateUpdate | null = null

  constructor(zilswap: Zilswap, contract: Contract) {
    this.zilswap = zilswap
    this.contract = contract
    this.contractHash = contract.address!
  }

  public async initialize(subscription?: OnStateUpdate) {
    if (subscription) this.stateObserver = subscription
    await this.zilswap.addToSubscription(this.contractHash);
    await this.updateZiloState()
  }

  public async updateZiloState() {
    const contractState = (await this.contract.getState()) as ZiloContractState
    console.log({ contractState })
    const stateOfContract = await this.checkStatus(contractState)

    const currentUser = this.zilswap.getAppState().currentUser;

    const userContribution = contractState.contributions[currentUser || '']
    const claimable = stateOfContract === ILO_STATE.Completed && new BigNumber(userContribution).isPositive()
    const contributed = userContribution > 0
    let contractInit = this.appState?.contractInit || null

    if (!contractInit) {
      const init = await this.zilswap.fetchContractInit(this.contract)

      contractInit = {
        _scilla_version: init.find((e: Value) => e.vname === '_scilla_version').value,
        zwap_address: init.find((e: Value) => e.vname === 'zwap_address').value,
        token_address: init.find((e: Value) => e.vname === 'token_address').value,
        token_amount: init.find((e: Value) => e.vname === 'token_amount').value,
        target_zil_amount: init.find((e: Value) => e.vname === 'target_zil_amount').value,
        target_zwap_amount: init.find((e: Value) => e.vname === 'target_zwap_amount').value,
        minimum_zil_amount: init.find((e: Value) => e.vname === 'minimum_zil_amount').value,
        liquidity_zil_amount: init.find((e: Value) => e.vname === 'liquidity_zil_amount').value,
        receiver_address: init.find((e: Value) => e.vname === 'receiver_address').value,
        liquidity_address: init.find((e: Value) => e.vname === 'liquidity_address').value,
        start_block: init.find((e: Value) => e.vname === 'start_block').value,
        end_block: init.find((e: Value) => e.vname === 'end_block').value,
        _creation_block: init.find((e: Value) => e.vname === '_creation_block').value,
        _this_address: init.find((e: Value) => e.vname === '_this_address').value,
      }
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
    // Set new state
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
   * ILO_STATE.Uninitialized = Contract deployed but not initialized
   * ILO_STATE.Pending = Contract initialized not stated (current block < start block)
   * ILO_STATE.Active = Contract started
   * ILO_STATE.Failed = Contract ended but target amount not reached
   * ILO_STATE.Completed = Contract ended and target amount fufilled
   *
   * @param contractState
   * @returns returns the current ILO_STATE
   */
  private async checkStatus(contractState: ZiloContractState): Promise<ILO_STATE> {
    const init = await this.zilswap.fetchContractInit(this.contract)

    if (!init || contractState.initialized.constructor !== 'True') {
      return ILO_STATE.Uninitialized
    }
    const currentBlock = this.zilswap.getCurrentBlock();
    const endBlock = init.find((e: Value) => e.vname === 'end_block').value as number
    const startBlock = init.find((e: Value) => e.vname === 'start_block').value as number
    const targetAmount = init.find((e: Value) => e.vname === 'target_zil_amount').value as string

    if (currentBlock < startBlock) {
      return ILO_STATE.Pending
    }

    if (currentBlock < endBlock) {
      return ILO_STATE.Active
    }

    if (new BigNumber(targetAmount).isGreaterThan(new BigNumber(contractState.total_contributions))) {
      return ILO_STATE.Failed
    } else {
      return ILO_STATE.Completed
    }
  }


  /**
 * Execute claim function if user contributed
 */
  public async claim(): Promise<ObservedTx | null> {
    // Check init
    this.zilswap.checkAppLoadedWithUser()

    // check if current state is claimable
    if (this.appState?.state !== ILO_STATE.Completed && this.appState?.state !== ILO_STATE.Failed) {
      throw new Error('Not yet claimable/refundable')
    }

    // no contributio
    if (!this.appState.contributed) {
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