const { getAddressFromPrivateKey, Zilliqa, BN, Long, toBech32Address } = require('@zilliqa-js/zilliqa')
const { ZilSwapV2 } = require('../src/zilswap-v2/ZilSwapV2')
const { getContractCodeHash, network, rpc, zilliqa, deployZilswapV2Router, deployWrappedZIL, useFungibleToken, increaseAllowance, setFeeConfig, getAmpBps, addPool, deployZilswapV2Pool } = require('../src/zilswap-v2/utils')
const { default: BigNumber } = require('bignumber.js')
require('dotenv').config()

let zilswap, privateKey, owner, tx
let router, token0, token1, token2, wZil, zrc2Pool1, zrc2Pool2, zilPool1, zilPool2, zilPool3, tokens, tokenPools
let routerState, zrc2Pool1State, zrc2Pool2State, zilPool1State, zilPool2State, zilPool3State


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

  afterAll(async () => {
    zrc2Pool1State = await zrc2Pool1.getState()
    tx = await zilswap.approveTokenTransferIfRequired(zrc2Pool1.address.toLowerCase(), zrc2Pool1State.balances[owner], router.address.toLowerCase())
    if (tx) { expect(tx.status).toEqual(2) }
    tx = await zilswap.removeLiquidity(token0.address.toLowerCase(), token1.address.toLowerCase(), zrc2Pool1.address.toLowerCase(), zrc2Pool1State.balances[owner], '0', '0')
    expect(tx.status).toEqual(2)

    zrc2Pool2State = await zrc2Pool2.getState()
    tx = await zilswap.approveTokenTransferIfRequired(zrc2Pool2.address.toLowerCase(), zrc2Pool2State.balances[owner], router.address.toLowerCase())
    if (tx) { expect(tx.status).toEqual(2) }
    tx = await zilswap.removeLiquidity(token1.address.toLowerCase(), token2.address.toLowerCase(), zrc2Pool2.address.toLowerCase(), zrc2Pool2State.balances[owner], '0', '0')
    expect(tx.status).toEqual(2)

    zilPool1State = await zilPool1.getState()
    await zilswap.approveTokenTransferIfRequired(zilPool1.address.toLowerCase(), zilPool1State.balances[owner], router.address.toLowerCase())
    if (tx) { expect(tx.status).toEqual(2) }
    tx = await zilswap.removeLiquidityZIL(token0.address.toLowerCase(), zilPool1.address.toLowerCase(), zilPool1State.balances[owner], '0', '0')
    expect(tx.status).toEqual(2)

    zilPool2State = await zilPool2.getState()
    await zilswap.approveTokenTransferIfRequired(zilPool2.address.toLowerCase(), zilPool2State.balances[owner], router.address.toLowerCase())
    if (tx) { expect(tx.status).toEqual(2) }
    tx = await zilswap.removeLiquidityZIL(token1.address.toLowerCase(), zilPool2.address.toLowerCase(), zilPool2State.balances[owner], '0', '0')
    expect(tx.status).toEqual(2)

    zilPool3State = await zilPool3.getState()
    await zilswap.approveTokenTransferIfRequired(zilPool3.address.toLowerCase(), zilPool3State.balances[owner], router.address.toLowerCase())
    if (tx) { expect(tx.status).toEqual(2) }
    tx = await zilswap.removeLiquidityZIL(token2.address.toLowerCase(), zilPool3.address.toLowerCase(), zilPool3State.balances[owner], '0', '0')
    expect(tx.status).toEqual(2)
  })

  test('initialize zilswap object', async () => {
    const routerAddress = toBech32Address(router.address.toLowerCase())
    zilswap = new ZilSwapV2(network, privateKey, routerAddress)
    await zilswap.initialize()
    zilswap.setDeadlineBlocks(10)
  })

  test('deploy and add zrc2Pool1', async () => {
    // Deploy pool
    [zrc2Pool1, tx] = await zilswap.deployAndAddPool(token0.address.toLowerCase(), token1.address.toLowerCase(), getAmpBps(true))
    expect(tx.status).toEqual(2)

    // Add Liquidity to new pool
    tx = await zilswap.addLiquidity(token0.address.toLowerCase(), token1.address.toLowerCase(), zrc2Pool1.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)

    // Add liquidity to existing pool
    tx = await zilswap.addLiquidity(token0.address.toLowerCase(), token1.address.toLowerCase(), zrc2Pool1.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)
  })

  test('deploy and add zrc2Pool2', async () => {
    // Deploy pool
    [zrc2Pool2, tx] = await zilswap.deployAndAddPool(token1.address.toLowerCase(), token2.address.toLowerCase(), getAmpBps(true))
    expect(tx.status).toEqual(2)

    // Add Liquidity to new pool
    tx = await zilswap.addLiquidity(token1.address.toLowerCase(), token2.address.toLowerCase(), zrc2Pool2.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)

    // Add liquidity to existing pool
    tx = await zilswap.addLiquidity(token1.address.toLowerCase(), token2.address.toLowerCase(), zrc2Pool2.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)
  })

  test('deploy and add zilPool1', async () => {
    // Deploy pool
    if (parseInt(token0.address, 16) > parseInt(wZil.address, 16)) {
      [zilPool1, tx] = await zilswap.deployAndAddPool(wZil.address.toLowerCase(), token0.address.toLowerCase(), getAmpBps(true))
    }
    else {
      [zilPool1, tx] = await zilswap.deployAndAddPool(token0.address.toLowerCase(), wZil.address.toLowerCase(), getAmpBps(true))
    }
    expect(tx.status).toEqual(2)

    // Add Liquidity to new pool
    tx = await zilswap.addLiquidityZIL(token0.address.toLowerCase(), zilPool1.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)

    // Add liquidity to existing pool
    tx = await zilswap.addLiquidityZIL(token0.address.toLowerCase(), zilPool1.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)
  })

  test('deploy and add zilPool2', async () => {
    // Deploy pool
    if (parseInt(token1.address, 16) > parseInt(wZil.address, 16)) {
      [zilPool2, tx] = await zilswap.deployAndAddPool(wZil.address.toLowerCase(), token1.address.toLowerCase(), getAmpBps(true))
    }
    else {
      [zilPool2, tx] = await zilswap.deployAndAddPool(token1.address.toLowerCase(), wZil.address.toLowerCase(), getAmpBps(true))
    }
    expect(tx.status).toEqual(2)

    // Add Liquidity to new pool
    tx = await zilswap.addLiquidityZIL(token1.address.toLowerCase(), zilPool2.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)

    // Add liquidity to existing pool
    tx = await zilswap.addLiquidityZIL(token1.address.toLowerCase(), zilPool2.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)
  })

  test('deploy and add zilPool3', async () => {
    // Deploy pool
    if (parseInt(token2.address, 16) > parseInt(wZil.address, 16)) {
      [zilPool3, tx] = await zilswap.deployAndAddPool(wZil.address.toLowerCase(), token2.address.toLowerCase(), getAmpBps(true))
    }
    else {
      [zilPool3, tx] = await zilswap.deployAndAddPool(token2.address.toLowerCase(), wZil.address.toLowerCase(), getAmpBps(true))
    }
    expect(tx.status).toEqual(2)

    // Add Liquidity to new pool
    tx = await zilswap.addLiquidityZIL(token2.address.toLowerCase(), zilPool3.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)

    // Add liquidity to existing pool
    tx = await zilswap.addLiquidityZIL(token2.address.toLowerCase(), zilPool3.address.toLowerCase(), new BigNumber(init_liquidity).shiftedBy(12).toString(), new BigNumber(init_liquidity).shiftedBy(12).toString(), '0', '0', 5)
    expect(tx.status).toEqual(2)
  })

  test('check sdk state', async () => {
    routerState = zilswap.getRouterState()
    poolState = zilswap.getPoolStates()
    tokens = zilswap.getTokens()
    tokenPools = zilswap.getTokenPools()

    console.log("routerState", routerState)
    console.log("poolState", poolState)
    console.log("tokens", tokens)

    console.log("token0.address.toLowerCase()", token0.address.toLowerCase())
    console.log("token1.address.toLowerCase()", token1.address.toLowerCase())
    console.log("token2.address.toLowerCase()", token2.address.toLowerCase())
    console.log("wZil.address.toLowerCase()", wZil.address.toLowerCase())
    console.log("tokenPools", tokenPools)
  })

  test('swap exact tokens for tokens', async () => {
    const txn = await zilswap.swapExactTokensForTokens(token0.address.toLowerCase(), wZil.address.toLowerCase(), new BigNumber(amountIn).shiftedBy(12).toString(), new BigNumber(amountOutMin).shiftedBy(12).toString())
    expect(txn.status).toEqual(2)
    // console.log(txn)
  })

  test('swap tokens for exact tokens', async () => {
    const txn = await zilswap.swapTokensForExactTokens(wZil.address.toLowerCase(), token0.address.toLowerCase(), new BigNumber(amountInMax).shiftedBy(12).toString(), new BigNumber(amountOut).shiftedBy(12).toString())
    expect(txn.status).toEqual(2)
    // console.log(txn)
  })

  test('swap exact zil for tokens', async () => {
    const txn = await zilswap.swapExactZILForTokens(wZil.address.toLowerCase(), token2.address.toLowerCase(), new BigNumber(amountIn).shiftedBy(12).toString(), new BigNumber(amountOutMin).shiftedBy(12).toString())
    expect(txn.status).toEqual(2)
    // console.log(txn)
  })

  test('swap zil for exact tokens', async () => {
    const txn = await zilswap.swapZILForExactTokens(wZil.address.toLowerCase(), token2.address.toLowerCase(), new BigNumber(amountInMax).shiftedBy(12).toString(), new BigNumber(amountOut).shiftedBy(12).toString())
    expect(txn.status).toEqual(2)
    // console.log(txn)
  })

  test('swap exact tokens for zil', async () => {
    const txn = await zilswap.swapExactTokensForZIL(token1.address.toLowerCase(), wZil.address.toLowerCase(), new BigNumber(amountIn).shiftedBy(12).toString(), new BigNumber(amountOutMin).shiftedBy(12).toString())
    expect(txn.status).toEqual(2)
    // console.log(txn)
  })

  test('swap tokens for exact zil', async () => {
    const txn = await zilswap.swapTokensForExactZIL(token1.address.toLowerCase(), wZil.address.toLowerCase(), new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    expect(txn.status).toEqual(2)
    // console.log(txn)
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
  token2 = (await useFungibleToken(privateKey, { symbol: 'TKN2', decimals: 12 }, router.address.toLowerCase(), null))[0]

  // Ordering the swaps such that the token addresses are in ascending order
  if (parseInt(token0.address, 16) > parseInt(token1.address, 16)) [token0, token1, token2] = [token1, token0, token2]
  if (parseInt(token1.address, 16) > parseInt(token2.address, 16)) [token0, token1, token2] = [token0, token2, token1]
  if (parseInt(token0.address, 16) > parseInt(token1.address, 16)) [token0, token1, token2] = [token1, token0, token2]

  await increaseAllowance(privateKey, wZil, router.address.toLowerCase())
  await setFeeConfig(privateKey, router, owner.toLowerCase())
}