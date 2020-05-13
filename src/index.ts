import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Contract } from '@zilliqa-js/contract'
import { fromBech32Address, toBech32Address } from '@zilliqa-js/crypto'
import { Value } from '@zilliqa-js/contract'
import { BN, Long, units } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'

import { APIS, CONTRACTS, TOKENS, CHAIN_VERSIONS, Network } from './constants'
import { toPositiveQa } from './utils'

const PRIVATE_KEY: string = process.env.PRIVATE_KEY || ''

export type Options = { deadlineBuffer?: number, gasPrice?: number, gasLimit?: number }

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
  pools: { [key in string]: Pool }
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
  private readonly zilliqa: Zilliqa
  private readonly tokens: { [key in string]: string } // symbol => hash mappings
  private readonly contract: Contract
  private readonly contractAddress: string
  private readonly deadlineBuffer: number = 10
  private readonly txParams: TxParams = {
    version: -1,
    gasPrice: toPositiveQa(1000, units.Units.Li),
    gasLimit: Long.fromNumber(10000)
  }

  private appState?: AppState

  constructor(network: Network, options?: Options) {
    this.zilliqa = new Zilliqa(APIS[network])
    if (!!PRIVATE_KEY) this.zilliqa.wallet.addByPrivateKey(PRIVATE_KEY)

    const contractHash = CONTRACTS[network]
    this.contract = this.zilliqa.contracts.at(contractHash)
    this.contractAddress = fromBech32Address(contractHash).toLowerCase()

    this.tokens = TOKENS[network]
    this.txParams.version = CHAIN_VERSIONS[network]

    if (options) {
      if (options.deadlineBuffer) this.deadlineBuffer = options.deadlineBuffer
      if (options.gasPrice) this.txParams.gasPrice = toPositiveQa(options.gasPrice, units.Units.Li)
      if (options.gasLimit) this.txParams.gasLimit = Long.fromNumber(options.gasLimit)
    }
  }

  async getAppState(forceUpdate: boolean = false): Promise<AppState> {
    if (!this.appState || forceUpdate) {
      await this.updateAppState()
    }
    return this.appState!
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

  private async getTokenDetails(id: string): Promise<TokenDetails> {
    let hash, address

    if (id.substr(0, 2) === '0x') {
      hash = id
      address = toBech32Address(hash)
    } else if (id.substr(0, 3) == 'zil') {
      address = id
      hash = fromBech32Address(address)
    } else {
      address = this.tokens[id]
      hash = fromBech32Address(address)
    }

    if (!!this.appState?.tokens[hash]) return this.appState.tokens[hash]

    const contract = this.zilliqa.contracts.at(address)
    const init = await contract.getInit()

    const decimalStr = init.find((e: Value) => e.vname === 'decimals').value as string
    const decimals = parseInt(decimalStr, 10)
    const symbol = init.find((e: Value) => e.vname === 'symbol').value as string

    return { contract, address, hash, symbol, decimals }
  }

  private async deadlineBlock(): Promise<string> {
    const appState = await this.getAppState()
    return (appState.updatedAtBNum + this.deadlineBuffer!).toString()
  }

  async addLiquidity(tokenSymbol: string, zilsToAddHuman: string, tokensToAddHuman: string) {
    if (!this.appState) await this.updateAppState()

    // Check user address
    if (this.appState!.currentUser === null) {
      throw new Error('Wallet not connected!')
    }

    // Format token amounts
    const token = await this.getTokenDetails(tokenSymbol)
    const tokensToAdd = new BN(toPositiveQa(tokensToAddHuman, token.decimals))
    const zilsToAdd = new BN(toPositiveQa(zilsToAddHuman, units.Units.Zil))

    // Check balance
    const tokenState = await token.contract.getState()
    const balance = new BN(tokenState.balances_map[this.appState!.currentUser!] || 0)
    if (balance.lt(tokensToAdd)) {
      throw new Error('Insufficent tokens in wallet to add liquidity!')
    }

    // We need to pre-approve the transfer of tokens whenever tokens
    // are moved from the user's address
    const allowance = new BN(tokenState.allowances_map[this.appState!.currentUser!][this.contractAddress] || 0)
    console.log(allowance.toString(), tokensToAdd.toString())
    if (allowance.lt(tokensToAdd)) {
      console.log('sending approve txn..')
      const approveTxn = await token.contract.call('IncreaseAllowance', [{
        vname: 'spender',
        type: 'ByStr20',
        value: this.contractAddress,
      }, {
        vname: 'amount',
        type: 'Uint128',
        value: tokenState.total_supply.toString(),
      }], {
        amount: new BN(0),
        ...this.txParams
      })
      console.log('approve txn sent!')
      const approveTxnReceipt = approveTxn.getReceipt()!
      console.log(JSON.stringify(approveTxnReceipt, null, 4))

      if (!approveTxnReceipt.success) {
        throw new Error('Failed to approve token transfer!')
      }

      this.updateAppState()
    }

    console.log('sending add liquidity txn..')
    const addLiquidityTxn = await this.contract.call('AddLiquidity', [{
      vname: 'token_address',
      type: 'ByStr20',
      value: token.address,
    }, {
      vname: 'min_contribution_amount',
      type: 'Uint128',
      value: '0',
    }, {
      vname: 'max_token_amount',
      type: 'Uint128',
      value: tokensToAdd.toString(),
    }, {
      vname: 'deadline_block',
      type: 'BNum',
      value: await this.deadlineBlock(),
    }], {
      amount: zilsToAdd, // _amount
      ...this.txParams
    })
    console.log("add liquidity txn sent!")
    const addLiquidityTxnReceipt = addLiquidityTxn.getReceipt()!
    console.log(JSON.stringify(addLiquidityTxnReceipt, null, 4))
  }
}

export { Zilswap }
