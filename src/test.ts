import { Zilswap, ObservedTx, TxStatus, TxReceipt } from './index'
import { Network } from './constants'

const key: string | undefined = process.env.PRIVATE_KEY || undefined
const zilswap = new Zilswap(Network.TestNet, key)

const test = async () => {
  // init
  await zilswap.initialize(printResults)

  // get app state
  console.log('\ninitial app state:\n')
  console.log(JSON.stringify(zilswap.getAppState(), null, 2))

  try {
    // approve token
    const tx0 = await zilswap.approveTokenTransferIfRequired('ITN', await zilswap.toUnitless('ITN', '100'))
    if (tx0) {
      console.log(`\ntx hash: ${tx0.hash}\n`)
      await waitForTx()
    }

    // add liquidity
    const tx1 = await zilswap.addLiquidity('ITN', await zilswap.toUnitless('ZIL', '4'), await zilswap.toUnitless('ITN', '4'))
    console.log(`\ntx hash: ${tx1.hash}\n`)
    // await waitForTx()

    // remove liquidity
    const pool = zilswap.getPool('ITN')
    const remove25Percent = pool!.userContribution.dividedToIntegerBy(4).toString()
    const tx2 = await zilswap.removeLiquidity('ITN', remove25Percent)
    console.log(`\ntx hash: ${tx2.hash}\n`)
    // await waitForTx()

    // constants
    const someITN = await zilswap.toUnitless('ITN', '0.1')
    const someZIL = await zilswap.toUnitless('ZIL', '0.1')

    // get expected rates for exact input
    const r1 = await zilswap.getRatesForInput('ITN', 'ZIL', someITN)
    console.log('\n0.1 ITN -> ZIL\n')
    console.log(JSON.stringify(r1, null, 2))

    // swap exact zrc2 to zil
    const tx3 = await zilswap.swapWithExactInput('ITN', 'ZIL', someITN)
    console.log(`\ntx hash: ${tx3.hash}\n`)
    // await waitForTx()

    // get expected rates for exact input
    const r2 = await zilswap.getRatesForInput('ZIL', 'ITN', someZIL)
    console.log('\n0.1 ZIL -> ITN\n')
    console.log(JSON.stringify(r2, null, 2))

    // swap exact zil to zrc2
    const tx4 = await zilswap.swapWithExactInput('ZIL', 'ITN', someZIL)
    console.log(`\ntx hash: ${tx4.hash}\n`)
    // await waitForTx()

    // get expected rates for exact output
    const r3 = await zilswap.getRatesForOutput('ITN', 'ZIL', someZIL)
    console.log('\nITN -> 0.1 ZIL\n')
    console.log(JSON.stringify(r3, null, 2))

    // swap zrc2 to exact zil
    const tx5 = await zilswap.swapWithExactOutput('ITN', 'ZIL', someZIL)
    console.log(`\ntx hash: ${tx5.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r4 = await zilswap.getRatesForOutput('ZIL', 'ITN', someITN)
    console.log('\nZIL -> 0.1 ITN\n')
    console.log(JSON.stringify(r4, null, 2))

    // swap zil to exact zrc2
    const tx6 = await zilswap.swapWithExactOutput('ZIL', 'ITN', someITN)
    console.log(`\ntx hash: ${tx6.hash}\n`)
    await waitForTx()
  } finally {
    await zilswap.teardown()
  }
}

const test2 = async () => {
  // init
  await zilswap.initialize(printResults)

  // get app state
  console.log('\ninitial app state:\n')
  console.log(JSON.stringify(zilswap.getAppState(), null, 2))

  try {
    // approve token
    const tx0 = await zilswap.approveTokenTransferIfRequired('XSGD', await zilswap.toUnitless('XSGD', '100'))
    if (tx0) {
      console.log(`\ntx hash: ${tx0.hash}\n`)
      await waitForTx()
    }

    // add liquidity
    const tx1 = await zilswap.addLiquidity('XSGD', await zilswap.toUnitless('ZIL', '8'), await zilswap.toUnitless('XSGD', '1'))
    console.log(`\ntx hash: ${tx1.hash}\n`)
    await waitForTx()

    // remove liquidity
    const pool = zilswap.getPool('XSGD')
    const remove25Percent = pool!.userContribution.dividedToIntegerBy(4).toString()
    const tx2 = await zilswap.removeLiquidity('XSGD', remove25Percent)
    console.log(`\ntx hash: ${tx2.hash}\n`)
    await waitForTx()

    // constants
    const someITN = await zilswap.toUnitless('ITN', '0.1')
    const someXSGD = await zilswap.toUnitless('XSGD', '0.1')

    // get expected rates for exact input
    const r1 = await zilswap.getRatesForInput('ITN', 'XSGD', someITN)
    console.log('\n0.1 ITN -> XSGD\n')
    console.log(JSON.stringify(r1, null, 2))

    // swap exact zrc2 to zrc2
    const tx3 = await zilswap.swapWithExactInput('ITN', 'XSGD', someITN)
    console.log(`\ntx hash: ${tx3.hash}\n`)
    await waitForTx()

    // get expected rates for exact input
    const r2 = await zilswap.getRatesForInput('XSGD', 'ITN', someXSGD)
    console.log('\n0.1 XSGD -> ITN\n')
    console.log(JSON.stringify(r2, null, 2))

    // swap exact zrc2 to zrc2
    const tx4 = await zilswap.swapWithExactInput('XSGD', 'ITN', someXSGD)
    console.log(`\ntx hash: ${tx4.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r3 = await zilswap.getRatesForOutput('ITN', 'XSGD', someXSGD)
    console.log('\nITN -> 0.1 XSGD\n')
    console.log(JSON.stringify(r3, null, 2))

    // swap zrc2 to exact zrc2
    const tx5 = await zilswap.swapWithExactOutput('ITN', 'XSGD', someXSGD)
    console.log(`\ntx hash: ${tx5.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r4 = await zilswap.getRatesForOutput('XSGD', 'ITN', someITN)
    console.log('\nXSGD -> 0.1 ITN\n')
    console.log(JSON.stringify(r4, null, 2))

    // swap zrc2 to exact zrc2
    const tx6 = await zilswap.swapWithExactOutput('XSGD', 'ITN', someITN)
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

;(async () => {
  console.log('test starting..')
  try {
    await test()
    await test2()
    console.log('test done!')
  } catch (err) {
    console.error(err)
    console.log('test failed!')
  }
})()
