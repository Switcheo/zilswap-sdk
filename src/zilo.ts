import { Contract, Value } from '@zilliqa-js/contract'
import { BN, Long } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'
import { ObservedTx, Zilswap } from './index'
import { ILOState } from './constants'
import { contractInitToMap, unitlessBigNumber } from './utils'

interface ADTValue {
  constructor: string
  argtypes: string[]
  arguments: Value[]
}

export type OnStateUpdate = (appState: ZiloAppState) => void

export type ZiloContractState = {
  initialized: ADTValue
  contributions: { [byStr20Address: string]: BigNumber }
  total_contributions: string
}

export type ZiloContractInit = {
  zwap_address: string
  token_address: string
  token_amount: BigNumber
  target_zil_amount: BigNumber
  target_zwap_amount: BigNumber
  minimum_zil_amount: BigNumber
  liquidity_zil_amount: BigNumber
  receiver_address: string
  liquidity_address: string
  start_block: number
  end_block: number
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
  userContribution: BigNumber
  contractInit: ZiloContractInit | null
}

/**
 * Zilo class to represent an instance of a ZilSwap Initial Launch Offering.
 *
 * Usage:
 * ```
 * const zilswap = new Zilswap(Network.TestNet)
 * await zilswap.initialize()
 * const zilo = await zilswap.registerZilo(ZILO_ADDRESS, ziloStateObserver)
 *
 * const ziloState = zilo.getZiloState()
 *
 * if (ziloState.state === ILOState.Active) {
 *    const amount = new BigNumber(1).shiftedBy(ZIL_DECIMALS).toString(10)
 *    const tx = await zilo.contribute(amount)
 *
 *    console.log("distribute TX sent", tx.hash)
 * } else {
 *    console.log("ZILO not yet active")
 * }
 * ```
 */
export class Zilo {
  private zilswap: Zilswap
  private contract: Contract
  private appState?: ZiloAppState

  private stateObserver?: OnStateUpdate

  constructor(zilswap: Zilswap, address: string) {
    this.zilswap = zilswap
    this.contract = zilswap.getContract(address)
  }

  public async initialize(observer?: OnStateUpdate) {
    this.updateObserver(observer)
    await this.updateZiloState()
  }

  public updateObserver(observer?: OnStateUpdate) {
    this.stateObserver = observer
  }

  private async fetchContractInit(): Promise<ZiloContractInit | undefined> {
    const result = await this.zilswap.fetchContractInit(this.contract)
    if (!result) return

    const rawInit = contractInitToMap(result)

    return {
      ...rawInit,

      token_amount: new BigNumber(rawInit.token_amount),
      target_zil_amount: new BigNumber(rawInit.target_zil_amount),
      target_zwap_amount: new BigNumber(rawInit.target_zwap_amount),
      minimum_zil_amount: new BigNumber(rawInit.minimum_zil_amount),
      liquidity_zil_amount: new BigNumber(rawInit.liquidity_zil_amount),

      start_block: parseInt(rawInit.start_block, 10),
      end_block: parseInt(rawInit.end_block, 10),
    } as ZiloContractInit
  }

  private async fetchContractState(): Promise<ZiloContractState> {
    const result = await this.contract.getState()

    const contributions: { [index: string]: BigNumber } = {}
    for (const byStr20Address of Object.keys(result.contributions)) {
      contributions[byStr20Address] = new BigNumber(result.contributions[byStr20Address])
    }

    return {
      ...result,
      contributions,
    } as ZiloContractState
  }

  public async updateZiloState() {
    const contractState = await this.fetchContractState()
    const stateOfContract = await this.checkStatus(contractState)

    const currentUser = this.zilswap.getAppState().currentUser

    const userContribution = contractState.contributions[currentUser || ''] ?? new BigNumber(0)
    const claimable = stateOfContract === ILOState.Completed && new BigNumber(userContribution).isPositive()
    const contributed = userContribution.gt(0)
    let contractInit = this.appState?.contractInit

    if (!contractInit) {
      contractInit = await this.fetchContractInit()
      if (!contractInit) {
        console.error(`Could not fetch contract init for Zilo ${this.contract.address}`)
        return
      }
    }

    const newState = {
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
    this.stateObserver?.(newState)
  }

  public async updateBlockHeight(height?: number) {
    if (!this.appState?.contractInit) {
      // not initialized, ignore update.
      return
    }

    if (typeof height === 'undefined') {
      const response = await this.zilswap.zilliqa.blockchain.getNumTxBlocks()
      height = parseInt(response.result!, 10)
    }

    const contractInit = this.appState.contractInit
    if (height === contractInit.start_block || height === contractInit.end_block) {
      // trigger update if start/end block is current height
      await this.updateZiloState()
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
    const contractInit = await this.fetchContractInit()

    if (!contractInit || contractState.initialized.constructor !== 'True') {
      return ILOState.Uninitialized
    }

    const currentBlock = this.zilswap.getCurrentBlock()

    if (currentBlock < contractInit.start_block) {
      return ILOState.Pending
    }

    if (currentBlock < contractInit.end_block) {
      return ILOState.Active
    }

    if (new BigNumber(contractInit.minimum_zil_amount).gt(new BigNumber(contractState.total_contributions))) {
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

    const claimTxn = await this.zilswap.callContract(this.contract, 'Claim', [], { amount: new BN(0), ...this.zilswap.txParams(), gasLimit: Long.fromNumber(20000) }, true)

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

    const completeTxn = await this.zilswap.callContract(
      this.contract,
      'Complete',
      [],
      { amount: new BN(0), ...this.zilswap.txParams() },
      true
    )

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
   * Contribute to the ILO, may need to increase token allowance before proceeding
   *
   * @param amountToContributeStr is the exact amount of ZIL to be contribute as a unitless string (without decimals).
   */
  public async contribute(amountToContributeStr: string): Promise<ObservedTx | null> {
    this.zilswap.checkAppLoadedWithUser()

    // Check init
    const amountToContribute = unitlessBigNumber(amountToContributeStr)

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
