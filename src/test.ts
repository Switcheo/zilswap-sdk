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
