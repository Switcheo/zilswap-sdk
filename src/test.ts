
import { Zilswap } from './index'
import { Network } from './constants'

const test = async () => {
  const zilswap = new Zilswap(Network.TestNet)
  await zilswap.addLiquidity('ITN', '0.42', '0.42')
}

(async () => {
  console.log('test starting..')
  await test()
  console.log('test done!')
})()
