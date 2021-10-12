
import BigNumber from 'bignumber.js'
import { sign, getPubKeyFromPrivateKey, getAddressFromPrivateKey } from '@zilliqa-js/crypto'
import { Zilswap, ObservedTx, TxStatus, TxReceipt } from './index'
import { Network, ZIL_HASH } from './constants'
import { arkMessage, arkChequeHash, hashMessage } from './utils'

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
    const tx0 = await zilswap.approveTokenTransferIfRequired('SWTH', await zilswap.toUnitless('SWTH', '100000'))
    if (tx0) {
      console.log(`\ntx hash: ${tx0.hash}\n`)
      await waitForTx()
    }

    // add liquidity
    const tx1 = await zilswap.addLiquidity('SWTH', await zilswap.toUnitless('ZIL', '10000'), await zilswap.toUnitless('SWTH', '10000'))
    console.log(`\ntx hash: ${tx1.hash}\n`)
    // await waitForTx()

    // remove liquidity
    const pool = zilswap.getPool('SWTH')
    const remove25Percent = pool!.userContribution.dividedToIntegerBy(4).toString()
    const tx2 = await zilswap.removeLiquidity('SWTH', remove25Percent)
    console.log(`\ntx hash: ${tx2.hash}\n`)
    // await waitForTx()

    // constants
    const someSWTH = await zilswap.toUnitless('SWTH', '0.1')
    const someZIL = await zilswap.toUnitless('ZIL', '0.1')

    // get expected rates for exact input
    const r1 = await zilswap.getRatesForInput('SWTH', 'ZIL', someSWTH)
    console.log('\n0.1 SWTH -> ZIL\n')
    console.log(JSON.stringify(r1, null, 2))

    // swap exact zrc2 to zil
    const tx3 = await zilswap.swapWithExactInput('SWTH', 'ZIL', someSWTH)
    console.log(`\ntx hash: ${tx3.hash}\n`)
    // await waitForTx()

    // get expected rates for exact input
    const r2 = await zilswap.getRatesForInput('ZIL', 'SWTH', someZIL)
    console.log('\n0.1 ZIL -> SWTH\n')
    console.log(JSON.stringify(r2, null, 2))

    // swap exact zil to zrc2
    const tx4 = await zilswap.swapWithExactInput('ZIL', 'SWTH', someZIL)
    console.log(`\ntx hash: ${tx4.hash}\n`)
    // await waitForTx()

    // get expected rates for exact output
    const r3 = await zilswap.getRatesForOutput('SWTH', 'ZIL', someZIL)
    console.log('\nSWTH -> 0.1 ZIL\n')
    console.log(JSON.stringify(r3, null, 2))

    // swap zrc2 to exact zil
    const tx5 = await zilswap.swapWithExactOutput('SWTH', 'ZIL', someZIL)
    console.log(`\ntx hash: ${tx5.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r4 = await zilswap.getRatesForOutput('ZIL', 'SWTH', someSWTH)
    console.log('\nZIL -> 0.1 SWTH\n')
    console.log(JSON.stringify(r4, null, 2))

    // swap zil to exact zrc2
    const tx6 = await zilswap.swapWithExactOutput('ZIL', 'SWTH', someSWTH)
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
    const tx0 = await zilswap.approveTokenTransferIfRequired('XSGD', await zilswap.toUnitless('XSGD', '100000'))
    if (tx0) {
      console.log(`\ntx hash: ${tx0.hash}\n`)
      await waitForTx()
    }

    // add liquidity
    const tx1 = await zilswap.addLiquidity('XSGD', await zilswap.toUnitless('ZIL', '100000'), await zilswap.toUnitless('XSGD', '10000'))
    console.log(`\ntx hash: ${tx1.hash}\n`)
    await waitForTx()

    // remove liquidity
    const pool = zilswap.getPool('XSGD')
    const remove25Percent = pool!.userContribution.dividedToIntegerBy(4).toString()
    const tx2 = await zilswap.removeLiquidity('XSGD', remove25Percent)
    console.log(`\ntx hash: ${tx2.hash}\n`)
    await waitForTx()

    // constants
    const someSWTH = await zilswap.toUnitless('SWTH', '0.1')
    const someXSGD = await zilswap.toUnitless('XSGD', '0.1')

    // get expected rates for exact input
    const r1 = await zilswap.getRatesForInput('SWTH', 'XSGD', someSWTH)
    console.log('\n0.1 SWTH -> XSGD\n')
    console.log(JSON.stringify(r1, null, 2))

    // swap exact zrc2 to zrc2
    const tx3 = await zilswap.swapWithExactInput('SWTH', 'XSGD', someSWTH)
    console.log(`\ntx hash: ${tx3.hash}\n`)
    await waitForTx()

    // get expected rates for exact input
    const r2 = await zilswap.getRatesForInput('XSGD', 'SWTH', someXSGD)
    console.log('\n0.1 XSGD -> SWTH\n')
    console.log(JSON.stringify(r2, null, 2))

    // swap exact zrc2 to zrc2
    const tx4 = await zilswap.swapWithExactInput('XSGD', 'SWTH', someXSGD)
    console.log(`\ntx hash: ${tx4.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r3 = await zilswap.getRatesForOutput('SWTH', 'XSGD', someXSGD)
    console.log('\nSWTH -> 0.1 XSGD\n')
    console.log(JSON.stringify(r3, null, 2))

    // swap zrc2 to exact zrc2
    const tx5 = await zilswap.swapWithExactOutput('SWTH', 'XSGD', someXSGD)
    console.log(`\ntx hash: ${tx5.hash}\n`)
    await waitForTx()

    // get expected rates for exact output
    const r4 = await zilswap.getRatesForOutput('XSGD', 'SWTH', someSWTH)
    console.log('\nXSGD -> 0.1 SWTH\n')
    console.log(JSON.stringify(r4, null, 2))

    // swap zrc2 to exact zrc2
    const tx6 = await zilswap.swapWithExactOutput('XSGD', 'SWTH', someSWTH)
    console.log(`\ntx hash: ${tx6.hash}\n`)
    await waitForTx()
  } finally {
    await zilswap.teardown()
  }
}

const test3 = () => {
  const msg = arkMessage('Execute', arkChequeHash({
    network: Network.TestNet,
    side: 'Buy',
    token: { id: '206', address: '0xc948942f55ef05a95a46bb58ee9b0a67b0f871fa' },
    price: { amount: new BigNumber(10000), address: ZIL_HASH },
    feeAmount: new BigNumber(250),
    expiry: 100,
    nonce: 0,
   }))
  console.log('Message:', msg)
  const address = getAddressFromPrivateKey(key!)
  console.log('Address:', address)
  const publicKey = getPubKeyFromPrivateKey(key!)
  console.log('Public Key:', publicKey)
  const hash = hashMessage(msg)
  console.log('Message Hash:', hash)
  const signature = sign(Buffer.from(hash, 'hex'), key!, publicKey)
  console.log('Signature:', signature)
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
    // await test()
    // await test2()
    test3()
    console.log('test done!')
  } catch (err) {
    console.error(err)
    console.log('test failed!')
  }
})()
