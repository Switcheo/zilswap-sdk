import { Zilswap } from './index'
import { Network } from './constants'

const test = async () => {
  const key: string = process.env.PRIVATE_KEY || ''
  const zilswap = new Zilswap(Network.TestNet, key)

  // init
  await zilswap.initialize()
  console.log(JSON.stringify(zilswap.getAppState(), null, 4))

  try {
    // add liquidity
    const receipt1 = await zilswap.addLiquidity('ITN', '4', '4')
    if (!receipt1.success) {
      console.error(JSON.stringify(receipt1, null, 4))
      throw new Error('txn failed')
    }
    console.log(JSON.stringify(zilswap.getAppState(), null, 4))

    // remove liquidity
    const pool = zilswap.getPool('ITN')
    const remove25Percent = pool!.userContribution.dividedToIntegerBy(4).toString()
    const receipt2 = await zilswap.removeLiquidity('ITN', remove25Percent)
    if (!receipt2.success) {
      console.error(JSON.stringify(receipt2, null, 4))
      throw new Error('txn failed')
    }
    console.log(JSON.stringify(zilswap.getAppState(), null, 4))

    // swap exact zrc2 to zil
    const receipt3 = await zilswap.swapWithExactInput('ITN', 'ZIL', '0.1')
    if (!receipt3.success) {
      console.error(JSON.stringify(receipt3, null, 4))
      throw new Error('txn failed')
    }
    console.log(JSON.stringify(zilswap.getAppState(), null, 4))

    // swap exact zil to zrc
    const receipt4 = await zilswap.swapWithExactInput('ZIL', 'ITN', '0.1')
    if (!receipt4.success) {
      console.error(JSON.stringify(receipt4, null, 4))
      throw new Error('txn failed')
    }
    console.log(JSON.stringify(zilswap.getAppState(), null, 4))

    // swap zrc2 to exact zil
    const receipt5 = await zilswap.swapWithExactOutput('ITN', 'ZIL', '0.1')
    if (!receipt5.success) {
      console.error(JSON.stringify(receipt5, null, 4))
      throw new Error('txn failed')
    }
    console.log(JSON.stringify(zilswap.getAppState(), null, 4))

    // swap zil to exact zrc2
    const receipt6 = await zilswap.swapWithExactOutput('ZIL', 'ITN', '0.1')
    if (!receipt6.success) {
      console.error(JSON.stringify(receipt6, null, 4))
      throw new Error('txn failed')
    }
    console.log(JSON.stringify(zilswap.getAppState(), null, 4))
  } finally {
    await zilswap.teardown()
  }
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
