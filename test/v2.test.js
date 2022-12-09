const { getAddressFromPrivateKey, Zilliqa, BN, Long, toBech32Address } = require('@zilliqa-js/zilliqa')
const { ZilSwapV2 } = require('../src/zilswap-v2/ZilSwapV2')
const { getContractCodeHash, network, rpc, zilliqa, deployZilswapV2Router, deployWrappedZIL, useFungibleToken, increaseAllowance, setFeeConfig, getAmpBps, addPool, deployZilswapV2Pool } = require('./util')
const { TransactionError } = require('@zilliqa-js/core')
const { default: BigNumber } = require('bignumber.js')
const { BASIS } = require('../src/constants')
require('dotenv').config()

let zilswap, privateKey, owner
let router, pool, token0, token1
let routerState, poolState, tokens
const codehash = getContractCodeHash("./src/zilswap-v2/contracts/ZilSwapPool.scilla");

describe("test", () => {
  beforeAll(async () => {
    await setup()
  })

  test('initialize zilswap object', async () => {
    jest.setTimeout(10000)
    const routerHash = toBech32Address(router.address.toLowerCase())
    zilswap = new ZilSwapV2(network, privateKey, routerHash)
    await zilswap.initialize()
  })

  test('deploy pool', async () => {
    jest.setTimeout(10000)
    pool = await zilswap.deployZilswapV2Pool(token0.address.toLowerCase(), token1.address.toLowerCase(), 10000)
    // console.log("pool", pool)
  })

  test('add pool', async () => {
    const poolAddress = pool.address.toLowerCase()
    const tx = await zilswap.addPool(poolAddress)
    // console.log('tx', tx)
    expect(tx.status).toEqual(2)
  })

  test('check sdk state', async () => {
    routerState = zilswap.getRouterState()
    poolState = zilswap.getPoolStates()
    tokens = zilswap.getTokens()

    console.log("routerState", routerState)
    console.log("poolState", poolState)
    console.log("tokens", tokens)
  })
})

// Helper Functions

async function setup() {
  privateKey = process.env.PRIVATE_KEY
  if (!privateKey || privateKey === '') {
    throw new Error("No private key provided")
  }
  owner = getAddressFromPrivateKey(privateKey)
  wZil = (await deployWrappedZIL(privateKey, { name: 'WrappedZIL', symbol: 'WZIL', decimals: 12, initSupply: '100000000000000000000000000000000000000' }))[0]
  router = (await deployZilswapV2Router(privateKey, { governor: owner, codehash, wZil: wZil.address.toLowerCase() }))[0]

  token0 = (await useFungibleToken(privateKey, { symbol: 'TKN0', decimals: 12 }, router.address.toLowerCase(), null))[0]
  token1 = (await useFungibleToken(privateKey, { symbol: 'TKN1', decimals: 12 }, router.address.toLowerCase(), null))[0]

  if (parseInt(token0.address, 16) > parseInt(token1.address, 16)) [token0, token1] = [token1, token0]

  await increaseAllowance(privateKey, wZil, router.address.toLowerCase())
  await setFeeConfig(privateKey, router, owner.toLowerCase())
}