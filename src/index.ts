import { Zilliqa } from '@zilliqa-js/zilliqa'
import { Contract } from '@zilliqa-js/contract'
import { fromBech32Address } from '@zilliqa-js/crypto'
import { Value } from '@zilliqa-js/contract'
import { BN, Long, units } from '@zilliqa-js/util'

import { APIS, CONTRACTS, TOKENS, CHAIN_VERSIONS, Network } from './constants'
import { toPositiveQa } from './utils'

const PRIVATE_KEY: string = process.env.PRIVATE_KEY || ''

export type Options = { deadlineBuffer?: number, gasPrice?: number, gasLimit?: number }

type TxParams = { version: number, gasPrice: BN, gasLimit: Long }
type TokenDetails = { contract: Contract, address: string, decimals: number }

class Zilswap {
  private readonly zilliqa : Zilliqa
  private readonly tokens : { [key in string] : string}
  private readonly contract : Contract
  private readonly contractAddress : string
  private readonly deadlineBuffer : number = 10
  private readonly txParams: TxParams = {
    version: -1,
    gasPrice: toPositiveQa(1000, units.Units.Li),
    gasLimit: Long.fromNumber(10000)
  }

  constructor(network: Network, options?: Options) {
    this.zilliqa = new Zilliqa(APIS[network])
    this.zilliqa.wallet.addByPrivateKey(PRIVATE_KEY)

    const contractHash = CONTRACTS[network]
    this.contract = this.zilliqa.contracts.at(contractHash)
    this.contractAddress = fromBech32Address(contractHash)

    this.tokens = TOKENS[network]
    this.txParams.version = CHAIN_VERSIONS[network]

    if (options) {
      if (options.deadlineBuffer) this.deadlineBuffer = options.deadlineBuffer
      if (options.gasPrice) this.txParams.gasPrice = toPositiveQa(options.gasPrice, units.Units.Li)
      if (options.gasLimit) this.txParams.gasLimit = Long.fromNumber(options.gasLimit)
    }
  }

  private async getTokenDetails(tokenSymbol: string) : Promise<TokenDetails> {
    const tokenHash = this.tokens[tokenSymbol]
    const contract = this.zilliqa.contracts.at(tokenHash)
    const address = fromBech32Address(tokenHash)

    const init = await contract.getInit()
    const decimalStr = init.find((e: Value) => e.vname === 'decimals').value as string
    const decimals = parseInt(decimalStr, 10)

    return { contract, address, decimals }
  }

  private async deadlineBlock() : Promise<string> {
    const response = await this.zilliqa.blockchain.getNumTxBlocks()
    return (parseInt(response.result!, 10) + this.deadlineBuffer!).toString()
  }

  async addLiquidity(tokenSymbol: string, zilsToAddHuman: string, tokensToAddHuman: string) {
    const token = await this.getTokenDetails(tokenSymbol)
    const tokensToAdd = new BN(toPositiveQa(tokensToAddHuman, token.decimals))
    const zilsToAdd = new BN(toPositiveQa(zilsToAddHuman, units.Units.Zil))

    // We need to pre-approve the transfer of tokens whenever tokens
    // are moved from the user's address
    const approveTxn = await token.contract.call('IncreaseAllowance', [{
      vname: 'spender',
      type: 'ByStr20',
      value: this.contractAddress,
    }, {
      vname: 'amount',
      type: 'Uint128',
      value: tokensToAdd.toString(),
    }], {
      amount: new BN(0),
      ...this.txParams
    })

    console.log("approve txn sent!")

    // Retrieving the transaction receipt
    const approveTxnReceipt = approveTxn.getReceipt()!
    console.log(JSON.stringify(approveTxnReceipt, null, 4))

    // Get the token contract state
    console.log('Getting contract state...')
    const tokenState = await token.contract.getState()
    console.log('The state of the contract is:')
    console.log(JSON.stringify(tokenState, null, 4))

    if (!approveTxnReceipt.success) {
      return
    }

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

    // Retrieving the transaction receipt
    const addLiquidityTxnReceipt = addLiquidityTxn.getReceipt()!
    console.log(JSON.stringify(addLiquidityTxnReceipt, null, 4))

    // Get the contract state
    console.log('Getting contract state...')
    const contractState = await this.contract.getState()
    console.log('The state of the contract is:')
    console.log(JSON.stringify(contractState, null, 4))
  }
}

export { Zilswap }
