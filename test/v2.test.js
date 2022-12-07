const { getAddressFromPrivateKey, Zilliqa, BN, Long, toBech32Address } = require('@zilliqa-js/zilliqa')
const { APIS, CHAIN_VERSIONS } = require('../src/constants')
const { ZilSwapV2 } = require('../src/zilswap-v2/ZilSwapV2')
const { compile, getNetwork, getContractCodeHash } = require('./util')
require('dotenv').config()

let network, rpc, zilliqa, zilswap, privateKey, owner, file, init
let routerAddress, token0Address, token1Address
const codehash = getContractCodeHash("./src/zilswap-v2/contracts/ZilSwapPool.scilla");

describe("test", () => {
  beforeAll(async () => {
    network = getNetwork()
    rpc = APIS[network]
    zilliqa = new Zilliqa(rpc)

    privateKey = process.env.privateKey
    if (!privateKey || privateKey === '') {
      throw new Error("No private key provided")
    }
    owner = getAddressFromPrivateKey(privateKey)
  })

  test('deploy router', async () => {
    const [routerContract, routerState] = await deployZilswapV2Router(privateKey, { governor: owner, codehash })
    routerAddress = routerContract.address.toLowerCase() // hex
  })

  test('deploy token0 and token1', async () => {
    file = "./src/zilswap-v2/contracts/FungibleToken.scilla"
    init = [
      // this parameter is mandatory for all init arrays
      {
        vname: '_scilla_version',
        type: 'Uint32',
        value: '0',
      },
      {
        vname: 'contract_owner',
        type: 'ByStr20',
        value: `${owner.toLowerCase()}`,
      },
      {
        vname: 'name',
        type: 'String',
        value: 'token',
      },
      {
        vname: 'symbol',
        type: 'String',
        value: 'token',
      },
      {
        vname: 'decimals',
        type: 'Uint32',
        value: "12",
      },
      {
        vname: 'init_supply',
        type: 'Uint128',
        value: "1000",
      }
    ];
    const [token0Contract, token0State] = await deployContract(privateKey, file, init)
    const [token1Contract, token1State] = await deployContract(privateKey, file, init)
    token0Address = token0Contract.address.toLowerCase()
    token1Address = token1Contract.address.toLowerCase()
  })

  test('initialize zilswap object', async () => {
    zilswap = new ZilSwapV2(network, privateKey, toBech32Address(routerAddress))
    zilswap.initialize()

  })

  test('deploy pool', async () => {
    await zilswap.deployPool(token0Address, token1Address, 10000)
  })

})

// Helper Functions
function useKey(privateKey) {
  const address = getAddressFromPrivateKey(privateKey)
  const accounts = Object.keys(zilliqa.wallet.accounts)
  if (accounts.findIndex(a => a.toLowerCase() === address.toLowerCase()) < 0) {
    zilliqa.wallet.addByPrivateKey(privateKey)
  }
  zilliqa.wallet.setDefault(address)
}

async function deployContract(privateKey, file, init) {
  useKey(privateKey)

  // Check for account
  const address = getAddressFromPrivateKey(privateKey)
  const balance = await zilliqa.blockchain.getBalance(address)
  if (balance.error) {
    throw new Error(balance.error.message)
  }

  const minGasPrice = await zilliqa.blockchain.getMinimumGasPrice()

  // Deploy contract
  const compressedCode = await compile(file)
  const contract = zilliqa.contracts.new(compressedCode, init)
  const [deployTx, s] = await contract.deployWithoutConfirm(
    {
      version: CHAIN_VERSIONS[network],
      amount: new BN(0),
      gasPrice: new BN(minGasPrice.result),
      gasLimit: Long.fromNumber(80000),
    },
    false,
  )

  // Check for txn acceptance
  if (!deployTx.id) {
    throw new Error(JSON.stringify(s.error || 'Failed to get tx id!', null, 2))
  }
  console.info(`Deployment transaction id: ${deployTx.id}`)

  const confirmedTx = await deployTx.confirm(deployTx.id, 33, 1000);

  // Check for txn execution success
  if (!confirmedTx.txParams.receipt.success) {
    const errors = confirmedTx.txParams.receipt.errors || {}
    const errMsgs = JSON.stringify(
      Object.keys(errors).reduce((acc, depth) => {
        const errorMsgList = errors[depth].map(num => TransactionError[num])
        return { ...acc, [depth]: errorMsgList }
      }, {}))
    const error = `Failed to deploy contract at ${file}!\n${errMsgs}`
    throw new Error(error)
  }

  // Print txn receipt
  console.log(`Deployment transaction receipt:\n${JSON.stringify(confirmedTx.txParams.receipt)}`)
  await nextBlock()

  // Refetch contract
  console.info(`The contract address is: ${s.address}`)
  // console.log('Refetching contract state...')
  const deployedContract = zilliqa.contracts.at(s.address)
  const state = await deployedContract.getState()

  // Print contract state
  console.log(`The state of the contract is:\n${JSON.stringify(state, null, 2)}`)

  // Return the contract and state
  return [deployedContract, state]
}

async function deployZilswapV2Router(privateKey, { governor = null, codehash } = {}) {
  // Check for key
  if (!privateKey || privateKey === '') {
    throw new Error('No private key was provided!')
  }

  if (!codehash || codehash === '') {
    throw new Error('No codehash was provided!')
  }

  // Default vars
  if (!governor) governor = getAddressFromPrivateKey(privateKey).toLowerCase()

  // Load file and contract initialization variables
  const file = `./src/zilswap-v2/contract/ZilSwapRouter.scilla`
  const init = [
    // this parameter is mandatory for all init arrays
    {
      vname: '_scilla_version',
      type: 'Uint32',
      value: '0',
    },
    {
      vname: 'init_governor',
      type: 'ByStr20',
      value: governor,
    },
    {
      vname: 'init_codehash',
      type: 'ByStr32',
      value: codehash,
    },
  ];
  console.log(init)

  console.info(`Deploying zilswap-v2 router...`)
  return deployContract(privateKey, file, init)
}