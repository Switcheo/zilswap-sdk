const { BN, Long, bytes, units } = require('@zilliqa-js/util')
const { Zilliqa } = require('@zilliqa-js/zilliqa')
const {
  fromBech32Address,
  getAddressFromPrivateKey,
} = require('@zilliqa-js/crypto')

const PRIVATE_KEY: string = process.env.PRIVATE_KEY

const TESTNET_CONTRACT = 'zil1saezdfa2xqlc58gq7cwrrypvka3wyfl250fy5n'
const TESTNET_TOKEN = 'zil18zlr57uhrmnk4mfkuawgv0un295k970a9s3lnq' // IToken - ITN

const GAS_PRICE = units.toQa('1000', units.Units.Li)

const zilliqa = new Zilliqa('https://dev-api.zilliqa.com')
zilliqa.wallet.addByPrivateKey(PRIVATE_KEY)

const addLiquidity = async (zilswapContract, tokenContract, chainVersion) => {
  const zilswap = zilliqa.contracts.at(zilswapContract)
  const token = zilliqa.contracts.at(tokenContract)

  const zilswapAddress = fromBech32Address(zilswapContract)
  const tokenAddress = fromBech32Address(tokenContract)

  const zilToAdd = new BN(units.toQa('0.42', units.Units.Zil))
  const tokensToAdd = new BN(units.toQa('0.42', units.Units.Zil))

  // We need to pre-approve the transfer of tokens whenever tokens
  // are moved from the user's address
  const approveTxn = await token.call('IncreaseAllowance', [{
    vname: 'spender',
    type: 'ByStr20',
    value: zilswapAddress,
  }, {
    vname: 'amount',
    type: 'Uint128',
    value: tokensToAdd.toString(),
  }], {
    version: chainVersion,
    amount: new BN(0),
    gasPrice: GAS_PRICE,
    gasLimit: Long.fromNumber(10000),
  })

  console.log("approve txn sent!")

  // Retrieving the transaction receipt
  console.log(JSON.stringify(approveTxn.receipt, null, 4))

  // Get the token contract state
  console.log('Getting contract state...')
  const tokenState = await token.getState()
  console.log('The state of the contract is:')
  console.log(JSON.stringify(tokenState, null, 4))

  if (!approveTxn.receipt.success) {
    return
  }

  const addLiquidityTxn = await zilswap.call('AddLiquidity', [{
    vname: 'token_address',
    type: 'ByStr20',
    value: tokenAddress,
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
    value: '1400000',
  }], {
    version: chainVersion,
    amount: zilToAdd, // _amount
    gasPrice: GAS_PRICE,
    gasLimit: Long.fromNumber(10000),
  })

  console.log("add liquidity txn sent!")

  // Retrieving the transaction receipt
  console.log(JSON.stringify(addLiquidityTxn.receipt, null, 4))

  // Get the contract state
  console.log('Getting contract state...')
  const contractState = await zilswap.getState()
  console.log('The state of the contract is:')
  console.log(JSON.stringify(contractState, null, 4))
}

const test = async () => {
  const CHAIN_ID = 333 // testnet
  const MSG_VERSION = 1
  const VERSION = bytes.pack(CHAIN_ID, MSG_VERSION)

  await addLiquidity(TESTNET_CONTRACT, TESTNET_TOKEN, VERSION)
}

(async () => {
  console.log('test starting..')
  await test()
  console.log('test done!')
})()
