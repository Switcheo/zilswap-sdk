import { Zilswap, ObservedTx, TxStatus, TxReceipt } from './index'
import { Network } from './constants'

const key: string = process.env.PRIVATE_KEY || ''
const zilswap = new Zilswap(Network.TestNet, key)

const test = async () => {
  // init
  await zilswap.initialize(printResults)

  // get app state
  console.log('\ninitial app state:\n')
  console.log(JSON.stringify(zilswap.getAppState(), null, 4))

  try {
    // add liquidity
    const tx1 = await zilswap.addLiquidity('ITN', '4', '4')
    console.log(`\ntx hash: ${tx1.hash}\n`)
    await waitForTx()

    // remove liquidity
    const pool = zilswap.getPool('ITN')
    const remove25Percent = pool!.userContribution.dividedToIntegerBy(4).toString()
    const tx2 = await zilswap.removeLiquidity('ITN', remove25Percent)
    console.log(`\ntx hash: ${tx2.hash}\n`)
    await waitForTx()

    // get expected rates for exact input
    const r1 = await zilswap.getRatesForInput('ITN', 'ZIL', '0.1')
    console.log("\n0.1 ITN -> ZIL\n")
    console.log(JSON.stringify(r1, null, 4))

    // swap exact zrc2 to zil
    const tx3 = await zilswap.swapWithExactInput('ITN', 'ZIL', '0.1')
    console.log(`\ntx hash: ${tx3.hash}\n`)
    await waitForTx()

    // get expected rates for exact input
    const r2 = await zilswap.getRatesForInput('ZIL', 'ITN', '0.1')
    console.log("\n0.1 ZIL -> ITN\n")
    console.log(JSON.stringify(r2, null, 4))

    // swap exact zil to zrc
    const tx4 = await zilswap.swapWithExactInput('ZIL', 'ITN', '0.1')
    console.log(`\ntx hash: ${tx4.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r3 = await zilswap.getRatesForOutput('ITN', 'ZIL', '0.1')
    console.log("\nITN -> 0.1 ZIL\n")
    console.log(JSON.stringify(r3, null, 4))

    // swap zrc2 to exact zil
    const tx5 = await zilswap.swapWithExactOutput('ITN', 'ZIL', '0.1')
    console.log(`\ntx hash: ${tx5.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r4 = await zilswap.getRatesForOutput('ZIL', 'ITN', '0.1')
    console.log("\nZIL -> 0.1 ITN\n")
    console.log(JSON.stringify(r4, null, 4))

    // swap zil to exact zrc2
    const tx6 = await zilswap.swapWithExactOutput('ZIL', 'ITN', '0.1')
    console.log(`\ntx hash: ${tx6.hash}\n`)
    await waitForTx()
  } finally {
    await zilswap.teardown()
  }
}

const printResults = (tx: ObservedTx, status: TxStatus, receipt?: TxReceipt) => {
  if (!receipt) {
    console.error(`\ntx ${tx.hash} failed with ${status}!\n`)
  } else if (status !== 'confirmed') {
    console.error(`\ntx ${tx.hash} failed with ${status}!\ntx receipt: \n`)
    console.error(JSON.stringify(receipt, null, 4))
  } else {
    console.log(`\ntx ${tx.hash} confirmed.\napp state:\n`)
    console.log(JSON.stringify(zilswap.getAppState(), null, 4))
  }
}

const waitForTx = async () => {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (zilswap.getObservedTxs().length === 0) {
        resolve()
      } else {
        setTimeout(check, 100)
      }
    }
    check()
  })
}

;(async () => {
  console.log('test starting..')
  try {
    await test()
    console.log('test done!')
  } catch (err) {
    console.error(err)
    console.log('test failed!')
  }
})()
