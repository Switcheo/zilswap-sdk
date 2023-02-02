import { fromBech32Address, getAddressFromPrivateKey, toBech32Address } from '@zilliqa-js/zilliqa'
import BigNumber from 'bignumber.js'
import * as dotenv from 'dotenv'
import { WZIL_CONTRACTS, ZILSWAPV2_CONTRACTS } from '../constants'
import { getContract, network } from './utils'
import { ObservedTx, TxReceipt, TxStatus, ZilSwapV2 } from './ZilSwapV2'
dotenv.config()

const init_liquidity = 10000
const amountIn = 10
const amountInMax = 100
const amountOut = 10
const amountOutMin = 1

const routerHash = fromBech32Address(ZILSWAPV2_CONTRACTS[network])
const wZilHash = fromBech32Address(WZIL_CONTRACTS[network])
const swthHash = '0x6e8894131c29177311f1f5ecb886f88c93ebe869'
const hunyHash = '0xff2d0cac3650e8107f49c4b384642270ae503c34'

const pool1Hash = '0x1db598d29a7db8d41710f79ea209eac9e2315b3b' // SWTH-HUNY
const pool2Hash = '0xde5ab2d0ae01bdaee1ac1efcdea5fb06c042591b' // wZIL-SWTH
const pool3Hash = '0xfe5a7b46ddf2197ec0c17fb737815df6427025a9' // wZIL-HUNY

let zilswap: ZilSwapV2
const printResults = (tx: ObservedTx, status: TxStatus, receipt?: TxReceipt) => {
  if (!receipt) {
    console.error(`\ntx ${tx.hash} failed with ${status}!\n`)
  } else if (status !== 'confirmed') {
    console.error(`\ntx ${tx.hash} failed with ${status}!\ntx receipt: \n`)
    console.error(JSON.stringify(receipt, null, 2))
  } else {
    console.log(`\ntx ${tx.hash} confirmed.\napp state:\n`)
    console.log(JSON.stringify(zilswap.getAppState(), null, 2))
  }
}

const waitForTx = async () => {
  return new Promise<void>(resolve => {
    const check = async () => {
      if ((await zilswap.getObservedTxs()).length === 0) {
        resolve()
      } else {
        setTimeout(check, 100)
      }
    }
    check()
  })
}

const getvReserverBounds = (poolHash: string): { vReserveMin: string, vReserveMax: string } => {
  const pools = zilswap.getPools()
  const pool = pools[poolHash]

  let vReserveA = parseInt(pool.contractState.v_reserve0)
  let vReserveB = parseInt(pool.contractState.v_reserve1)

  let vReserveMin, vReserveMax;
  if (vReserveA === 0 && vReserveB === 0) {
    vReserveMin = '0'
    vReserveMax = '0'
  }
  else {
    const q112: any = new BigNumber(2).pow(112)
    vReserveMin = new BigNumber((vReserveB / vReserveA) * q112 / 1.05).toString(10)
    vReserveMax = new BigNumber((vReserveB / vReserveA) * q112 * 1.05).toString(10)
  }
  return { vReserveMin, vReserveMax }
}

const test = async () => {
  const privateKey = process.env.PRIVATE_KEY!
  const owner = getAddressFromPrivateKey(privateKey).toLowerCase()

  const routerAddress = toBech32Address(routerHash)
  zilswap = new ZilSwapV2(network, privateKey)
  await zilswap.initialize(printResults)
  zilswap.setDeadlineBlocks(10)
  console.log('\ninitial app state:\n')
  console.log(JSON.stringify(zilswap.getAppState(), null, 2))
  console.log("ObservedTxs: ", await zilswap.getObservedTxs())

  const pools = zilswap.getPools()
  const pool1 = pools[pool1Hash]  // SWTH-HUNY
  const pool2 = pools[pool2Hash]  // wZIL-SWTH
  const pool3 = pools[pool3Hash]  // wZIL-HUNY

  try {
    let tx;
    // approve token
    tx = await zilswap.approveTokenTransferIfRequired(wZilHash, '100000000000000000000000000000000000000', routerHash)
    if (tx) {
      console.log(`\ntx hash: ${tx.hash}\n`)
      await waitForTx()
    }
    tx = await zilswap.approveTokenTransferIfRequired(swthHash, '100000000000000000000000000000000000000', routerHash)
    if (tx) {
      console.log(`\ntx hash: ${tx.hash}\n`)
      await waitForTx()
    }
    tx = await zilswap.approveTokenTransferIfRequired(hunyHash, '100000000000000000000000000000000000000', routerHash)
    if (tx) {
      console.log(`\ntx hash: ${tx.hash}\n`)
      await waitForTx()
    }

    // add liquidity
    tx = await zilswap.addLiquidity(swthHash, hunyHash, pool1Hash, new BigNumber(init_liquidity).toString(), new BigNumber(init_liquidity).toString(), '0', '0', getvReserverBounds(pool1Hash).vReserveMin, getvReserverBounds(pool1Hash).vReserveMax)
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()
    tx = await zilswap.addLiquidityZIL(swthHash, pool2Hash, new BigNumber(init_liquidity).toString(), new BigNumber(init_liquidity).toString(), '0', '0', getvReserverBounds(pool2Hash).vReserveMin, getvReserverBounds(pool2Hash).vReserveMax)
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()
    tx = await zilswap.addLiquidityZIL(hunyHash, pool3Hash, new BigNumber(init_liquidity).toString(), new BigNumber(init_liquidity).toString(), '0', '0', getvReserverBounds(pool3Hash).vReserveMin, getvReserverBounds(pool3Hash).vReserveMax)
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()

    // swap
    // const r1 = await zilswap.getOutputForExactInput(swthHash, hunyHash, new BigNumber(amountIn).toString(), new BigNumber(amountOutMin).toString())
    // console.log(`\n${amountIn} SWTH -> HUNY: ${r1} SWTH\n`)
    tx = await zilswap.swapExactTokensForTokens([pool1], swthHash, new BigNumber(amountIn).toString(), new BigNumber(amountOutMin).toString())
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()
    tx = await zilswap.swapExactTokensForTokens([pool2, pool3], swthHash, new BigNumber(amountIn).toString(), new BigNumber(amountOutMin).toString())
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()

    // const r2 = await zilswap.getInputForExactOutput(swthHash, hunyHash, new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    // console.log(`\nSWTH -> ${amountOut} HUNY: ${r2} SWTH\n`)
    tx = await zilswap.swapTokensForExactTokens([pool1], hunyHash, new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()
    tx = await zilswap.swapTokensForExactTokens([pool3, pool2], hunyHash, new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()

    // const r3 = await zilswap.getOutputForExactInput(wZilHash, hunyHash, new BigNumber(amountIn).toString(), new BigNumber(amountOutMin).toString())
    // console.log(`\n${amountIn} ZIL -> SWTH: ${r3} SWTH\n`)
    // tx = await zilswap.swapExactZILForTokens(wZilHash, swthHash, new BigNumber(amountIn).toString(), new BigNumber(amountOutMin).toString())
    // console.log(`\ntx hash: ${tx.hash}\n`)
    // await waitForTx()

    // const r4 = await zilswap.getInputForExactOutput(wZilHash, swthHash, new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    // console.log(`\nZIL -> ${amountOut} SWTH: ${r4} ZIL\n`)
    // tx = await zilswap.swapZILForExactTokens(wZilHash, swthHash, new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    // console.log(`\ntx hash: ${tx.hash}\n`)
    // await waitForTx()

    // const r5 = await zilswap.getOutputForExactInput(hunyHash, wZilHash, new BigNumber(amountIn).toString(), new BigNumber(amountOutMin).toString())
    // console.log(`\n${amountIn} HUNY -> ZIL: ${r5} HUNY\n`)
    // tx = await zilswap.swapExactTokensForZIL(hunyHash, wZilHash, new BigNumber(amountIn).toString(), new BigNumber(amountOutMin).toString())
    // console.log(`\ntx hash: ${tx.hash}\n`)
    // await waitForTx()

    // const r6 = await zilswap.getInputForExactOutput(hunyHash, wZilHash, new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    // console.log(`\nZIL -> ${amountOut} SWTH: ${r6} ZIL\n`)
    // tx = await zilswap.swapTokensForExactZIL(hunyHash, wZilHash, new BigNumber(amountInMax).toString(), new BigNumber(amountOut).toString())
    // console.log(`\ntx hash: ${tx.hash}\n`)
    // await waitForTx()

    // approve LP tokens
    tx = await zilswap.approveTokenTransferIfRequired(pool1Hash, '100000000000000000000000000000000000000', routerHash)
    if (tx) {
      console.log(`\ntx hash: ${tx.hash}\n`)
      await waitForTx()
    }
    tx = await zilswap.approveTokenTransferIfRequired(pool2Hash, '100000000000000000000000000000000000000', routerHash)
    if (tx) {
      console.log(`\ntx hash: ${tx.hash}\n`)
      await waitForTx()
    }
    tx = await zilswap.approveTokenTransferIfRequired(pool3Hash, '100000000000000000000000000000000000000', routerHash)
    if (tx) {
      console.log(`\ntx hash: ${tx.hash}\n`)
      await waitForTx()
    }

    // remove liquidity
    const pool1Liquidity = (await getContract(pool1Hash).getState()).balances[owner]
    const pool2Liquidity = (await getContract(pool2Hash).getState()).balances[owner]
    const pool3Liquidity = (await getContract(pool3Hash).getState()).balances[owner]
    tx = await zilswap.removeLiquidity(swthHash, hunyHash, pool1Hash, pool1Liquidity, '0', '0')
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()
    tx = await zilswap.removeLiquidityZIL(swthHash, pool2Hash, pool2Liquidity, '0', '0')
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()
    tx = await zilswap.removeLiquidityZIL(hunyHash, pool3Hash, pool3Liquidity, '0', '0')
    console.log(`\ntx hash: ${tx.hash}\n`)
    await waitForTx()
  }
  finally {
    await zilswap.teardown()
  }
}

  ; (async () => {
    console.log('test starting..')
    try {
      await test()
      console.log('test done!')
    } catch (err) {
      console.error(err)
      console.log('test failed!')
    }
  })()
