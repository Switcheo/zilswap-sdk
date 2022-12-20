const { getAddressFromPrivateKey, Zilliqa, BN, Long, toBech32Address } = require('@zilliqa-js/zilliqa')
const { ZilSwapV2 } = require('../src/zilswap-v2/ZilSwapV2')
const { getContractCodeHash, network, rpc, zilliqa, deployZilswapV2Router, deployWrappedZIL, useFungibleToken, increaseAllowance, setFeeConfig, getAmpBps, addPool, deployZilswapV2Pool } = require('../src/zilswap-v2/utils')
const { default: BigNumber } = require('bignumber.js')
require('dotenv').config()

let zilswap, privateKey, owner, tx
let router, pool, token0, token1, routerState, poolState, tokens
const codehash = getContractCodeHash("./src/zilswap-v2/contracts/ZilSwapPool.scilla");
const init_liquidity = 10000
const amountIn = 100
const amountInMax = 1000
const amountOut = 100
const amountOutMin = 10

describe("test", () => {
  beforeAll(async () => {
    await setup()
  })

  test('initialize zilswap object', async () => {
    jest.setTimeout(20000)
    const routerHash = toBech32Address(router.address.toLowerCase())
    zilswap = new ZilSwapV2(network, privateKey, routerHash)
    await zilswap.initialize()
    zilswap.setDeadlineBlocks(10)
  })

  test('deploy amp pool (non-ZIL)', async () => {
    jest.setTimeout(20000)
    pool = await zilswap.deployZilswapV2Pool(token0.address.toLowerCase(), token1.address.toLowerCase(), getAmpBps(true))
  })

  test('add amp pool (non-ZIL)', async () => {
    const poolAddress = pool.address.toLowerCase()
    tx = await zilswap.addPool(poolAddress)
    expect(tx.status).toEqual(2)
  })

  test('addLiquidity to amp pool (non-ZIL)', async () => {
    jest.setTimeout(20000)

    // Add Liquidity to new pool
    tx = await zilswap.addLiquidity(token0.address.toLowerCase(), token1.address.toLowerCase(), pool.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)

    // Add liquidity to existing pool
    tx = await zilswap.addLiquidity(token0.address.toLowerCase(), token1.address.toLowerCase(), pool.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)
  })

  test('removeLiquidity', async () => {
    jest.setTimeout(20000)
    poolState = await pool.getState()
    // console.log("poolState", poolState)
    // console.log("owner", owner)
    // console.log("poolState.balances[owner]", poolState.balances[owner])

    // Increase allowance of LP tokens
    await zilswap.increaseAllowance(pool, router.address.toLowerCase(), poolState.balances[owner])

    // Remove Liquidity to pool
    tx = await zilswap.removeLiquidity(token0.address.toLowerCase(), token1.address.toLowerCase(), pool.address.toLowerCase(), poolState.balances[owner], '0', '0')
    expect(tx.status).toEqual(2)
  })

  test('deploy amp pool (ZIL)', async () => {
    jest.setTimeout(20000)

    if (parseInt(token0.address, 16) > parseInt(wZil.address, 16)) {
      pool = await zilswap.deployZilswapV2Pool(wZil.address.toLowerCase(), token0.address.toLowerCase(), getAmpBps(true))
    }
    else {
      pool = await zilswap.deployZilswapV2Pool(token0.address.toLowerCase(), wZil.address.toLowerCase(), getAmpBps(true))
    }
  })

  test('add pool (ZIL)', async () => {
    const poolAddress = pool.address.toLowerCase()
    tx = await zilswap.addPool(poolAddress)
    expect(tx.status).toEqual(2)
  })

  test('addLiquidityZIL to amp pool (ZIL)', async () => {
    jest.setTimeout(20000)

    // Add Liquidity to new pool
    tx = await zilswap.addLiquidityZIL(token0.address.toLowerCase(), pool.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)

    // Add liquidity to existing pool
    tx = await zilswap.addLiquidityZIL(token0.address.toLowerCase(), pool.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)
  })

  test('removeLiquidityZIL', async () => {
    jest.setTimeout(20000)
    poolState = await pool.getState()

    // Increase allowance of LP tokens
    await zilswap.increaseAllowance(pool, router.address.toLowerCase(), poolState.balances[owner])

    // Remove Liquidity to pool
    tx = await zilswap.removeLiquidityZIL(token0.address.toLowerCase(), pool.address.toLowerCase(), poolState.balances[owner], '0', '0')
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
  owner = getAddressFromPrivateKey(privateKey).toLowerCase()
  wZil = (await deployWrappedZIL(privateKey, { name: 'WrappedZIL', symbol: 'WZIL', decimals: 12, initSupply: '100000000000000000000000000000000000000' }))[0]
  router = (await deployZilswapV2Router(privateKey, { governor: owner, codehash, wZil: wZil.address.toLowerCase() }))[0]

  token0 = (await useFungibleToken(privateKey, { symbol: 'TKN0', decimals: 12 }, router.address.toLowerCase(), null))[0]
  token1 = (await useFungibleToken(privateKey, { symbol: 'TKN1', decimals: 12 }, router.address.toLowerCase(), null))[0]

  if (parseInt(token0.address, 16) > parseInt(token1.address, 16)) [token0, token1] = [token1, token0]

  await increaseAllowance(privateKey, wZil, router.address.toLowerCase())
  await setFeeConfig(privateKey, router, owner.toLowerCase())
}