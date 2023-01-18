import { Transaction } from "@zilliqa-js/account";
import { Contract, Value } from "@zilliqa-js/contract";
import { TransactionError } from '@zilliqa-js/core';
import { BN, getAddressFromPrivateKey, Long, units, Zilliqa } from "@zilliqa-js/zilliqa";
import BigNumber from "bignumber.js";
import Crypto from "crypto";
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as util from 'util';
import { APIS, CHAIN_VERSIONS, Network } from "../constants";
dotenv.config()

export const PRECISION = 1000000000000000000
export const SHORT_ALPHA = 370301795963710
export const LONG_ALPHA = 185168039996296

const getNetwork = (): Network => {
  const network: string = (process.env.NETWORK || '').toLowerCase()
  switch (network) {
    case 'mainnet':
      return Network.MainNet
    case 'testnet':
      return Network.TestNet
    // case 'localhost':
    //   return Network.LocalHost
    default:
      return Network.TestNet
  }
}

const getRPC = (network: Network): string => {
  return APIS[network]
}

export const network = getNetwork()
export const rpc = getRPC(network)
export const zilliqa = new Zilliqa(rpc)

export const param = (vname: string, type: string, value: string) => {
  return { vname, type, value };
}

const randomHex = (size: number): string => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')

const readFile = util.promisify(fs.readFile)
const matchComments = /[(][*].*?[*][)]/gs

export const compile = async (file: string) => {
  const code = (await readFile(file)).toString()
  return compress(code);
}

export const compress = (code: string) => {
  return code.replace(matchComments, '')
}

export const getContract = (address: string): Contract => {
  return zilliqa.contracts.at(address)
}

export const getContractCodeHash = (file: string): string => {
  const code = fs.readFileSync(file).toString()
  const compressedCode = compress(code)
  const buffer = Buffer.from(compressedCode)
  return "0x" + Crypto.createHash("sha256").update(buffer).digest("hex");
};

export const getAmpBps = (isAmpPool: boolean) => {
  const ampBps = isAmpPool ? "15000" : "10000";
  return ampBps;
}

async function getBlockNum() {
  const response = process.env.NETWORK === 'localhost' ? await zilliqa.provider.send('GetBlocknum', "") : await zilliqa.blockchain.getNumTxBlocks()
  if (!response.result) {
    throw new Error(`Failed to get block! Error: ${JSON.stringify(response.error)}`)
  }
  return parseInt(response.result, 10)
}

// async function nextBlock(n = 1) {
//   if (process.env.NETWORK === 'localhost') {
//     // console.log('Advancing block...')
//     const response = await zilliqa.provider.send('IncreaseBlocknum', n)
//     if (!response.result) {
//       throw new Error(`Failed to advanced block! Error: ${JSON.stringify(response.error)}`)
//     }
//   }
// }

function useKey(privateKey: string) {
  const address = getAddressFromPrivateKey(privateKey)
  const accounts = Object.keys(zilliqa.wallet.accounts)
  if (accounts.findIndex(a => a.toLowerCase() === address.toLowerCase()) < 0) {
    zilliqa.wallet.addByPrivateKey(privateKey)
  }
  zilliqa.wallet.setDefault(address)
}

export async function addPool(privateKey: string, router: Contract, poolAddress: string) {
  const tx = await callContract(
    privateKey, router,
    'AddPool',
    [
      {
        vname: 'pool',
        type: 'ByStr20',
        value: poolAddress,
      },
    ],
    0, false, false
  )
}

export async function setFeeConfig(privateKey: string, router: Contract, feeAddress: string) {
  const tx = await callContract(
    privateKey, router,
    'SetFeeConfiguration',
    [
      {
        vname: 'config',
        type: 'Pair ByStr20 Uint128',
        value: {
          "constructor": "Pair",
          "argtypes": ["ByStr20", "Uint128"],
          "arguments": [`${feeAddress}`, "1000"] // 10%
        }
      },
    ],
    0, false, false
  )
}

export async function increaseAllowance(privateKey: string, contract: Contract, spender: string): Promise<void> {
  const tx = await callContract(
    privateKey, contract,
    'IncreaseAllowance',
    [
      {
        vname: 'spender',
        type: 'ByStr20',
        value: spender, // contract hash
      },
      {
        vname: 'amount',
        type: 'Uint128',
        value: '100000000000000000000000000000000000000',
      },
    ],
    0, false, false
  )
}

export async function callContract(privateKey: string, contract: Contract, transition: string, args: any,
  zilsToSend: number = 0, insertRecipientAsSender: boolean = true, insertDeadlineBlock: boolean = true): Promise<Transaction> {

  useKey(privateKey)

  const address = getAddressFromPrivateKey(privateKey)

  if (insertDeadlineBlock) {
    const deadline = (await getBlockNum()) + 10
    args.push(
      {
        vname: 'deadline_block',
        type: 'BNum',
        value: deadline.toString(),
      }
    )
  }

  if (insertRecipientAsSender) {
    args.push(
      {
        vname: 'recipient_address',
        type: 'ByStr20',
        value: address,
      }
    )
  }
  const minGasPrice = await zilliqa.blockchain.getMinimumGasPrice()

  console.info(`Calling: ${transition}`)
  const tx = await contract.call(transition, args,
    {
      version: CHAIN_VERSIONS[network],
      amount: units.toQa(zilsToSend, units.Units.Zil),
      gasPrice: new BN(minGasPrice.result!),
      gasLimit: Long.fromNumber(80000),
    }, 33, 1000, true
  )

  const receipt = tx.getReceipt()

  if (receipt && !receipt.success) {
    const errors = receipt.errors
    if (errors) {
      const errMsgs = Object.keys(errors).reduce((acc, depth) => {
        const errorMsgList = errors[depth].map((num: any) => TransactionError[num])
        return { ...acc, [depth]: errorMsgList }
      }, {})
      console.info(`Contract call for ${transition} failed:\n${JSON.stringify(errMsgs, null, 2)}\n` +
        `${receipt.exceptions ? `Exceptions:\n${JSON.stringify(receipt.exceptions, null, 2)}\n` : ''}` +
        `Parameters:\n${JSON.stringify(args)}\n`
      )
    }
  }

  // await nextBlock()

  return tx
}

export async function deployContract(privateKey: string, file: string, init: Value[]) {
  // Check for key
  if (privateKey === '') {
    throw new Error('No private key was provided!')
  }

  useKey(privateKey)

  // Check for account
  const address = getAddressFromPrivateKey(privateKey)
  const balance = await zilliqa.blockchain.getBalance(address)
  if (balance.error) {
    throw new Error(balance.error.message)
  }

  const minGasPrice = await zilliqa.blockchain.getMinimumGasPrice()
  // console.log("minGasPrice", minGasPrice)

  // Deploy contract
  const compressedCode = await compile(file)
  const contract = zilliqa.contracts.new(compressedCode, init)
  const [deployTx, s] = await contract.deployWithoutConfirm(
    {
      version: CHAIN_VERSIONS[network],
      gasPrice: new BN(minGasPrice.result!),
      gasLimit: Long.fromNumber(80000),
    },
    false,
  )

  // Check for txn acceptance
  if (!deployTx.id) {
    throw new Error(JSON.stringify(s.error || 'Failed to get tx id!', null, 2))
  }
  console.info(`Deployment transaction id: ${deployTx.id}`)

  const confirmedTx = await deployTx.confirm(deployTx.id, 33, 1000);

  // Check for txn execution success
  if (!confirmedTx.txParams.receipt!.success) {
    const errors = confirmedTx.txParams.receipt!.errors || {}
    const errMsgs = JSON.stringify(
      Object.keys(errors).reduce((acc, depth) => {
        const errorMsgList = errors[depth].map((num: any) => TransactionError[num])
        return { ...acc, [depth]: errorMsgList }
      }, {}))
    const error = `Failed to deploy contract at ${file}!\n${errMsgs}`
    throw new Error(error)
  }

  // Print txn receipt
  console.log(`Deployment transaction receipt:\n${JSON.stringify(confirmedTx.txParams.receipt)}`)
  // await nextBlock()

  // Refetch contract
  console.info(`The contract address is: ${s.address}`)
  // console.log('Refetching contract state...')
  const deployedContract = zilliqa.contracts.at(s.address!)
  const state = await deployedContract.getState()

  // Print contract state
  console.log(`The state of the contract is:\n${JSON.stringify(state, null, 2)}`)

  // Return the contract and state
  return [deployedContract, state]
}

export async function deployWrappedZIL(privateKey: string, { name = 'WZIL Token', symbol = 'WZIL', decimals = 12, initSupply = '1000000000000000000000' }: { name: string, symbol: string, decimals: number | null, initSupply: string | null }) {
  // Check for key
  if (privateKey === '') {
    throw new Error('No private key was provided!')
  }

  // Generate default vars
  const address = getAddressFromPrivateKey(privateKey)

  // Load file and contract initialization variables
  const file = './src/zilswap-v2/contracts/WrappedZil.scilla'
  const init = [
    // this parameter is mandatory for all init arrays
    {
      vname: '_scilla_version',
      type: 'Uint32',
      value: '0',
    },
    {
      vname: 'name',
      type: 'String',
      value: `${name}`,
    },
    {
      vname: 'symbol',
      type: 'String',
      value: `${symbol}`,
    },
    {
      vname: 'decimals',
      type: 'Uint32',
      value: `${decimals}`,
    },
    {
      vname: 'init_supply',
      type: 'Uint128',
      value: `${initSupply}`,
    },
    {
      vname: 'contract_owner',
      type: 'ByStr20',
      value: `${address}`,
    },
  ]

  console.info(`Deploying Wrapped Zil Token...`)
  return deployContract(privateKey, file, init)
}

export async function deployZilswapV2Router(privateKey: string, { governor, codehash, wZil }: { governor: string | null, codehash: string, wZil: string }) {
  // Check for key
  if (privateKey === '') {
    throw new Error('No private key was provided!')
  }

  // Default vars
  if (!governor) governor = getAddressFromPrivateKey(privateKey).toLowerCase()

  // Load file and contract initialization variables
  const file: string = `./src/zilswap-v2/contracts/ZilSwapRouter.scilla`
  const init: Value[] = [
    // this parameter is mandatory for all init arrays
    {
      vname: '_scilla_version',
      type: 'Uint32',
      value: '0',
    },
    {
      vname: 'init_governor',
      type: 'ByStr20',
      value: governor,
    },
    {
      vname: 'init_codehash',
      type: 'ByStr32',
      value: codehash,
    },
    {
      vname: 'init_wZIL_address',
      type: 'ByStr20',
      value: wZil,
    }
  ];
  console.log(init)

  console.info(`Deploying zilswap-v2 router...`)
  return deployContract(privateKey, file, init)
}

export async function deployZilswapV2Pool(privateKey: string, { router, token0, token1, init_amp_bps, name, symbol }: { router: Contract, token0: Contract, token1: Contract, init_amp_bps: string, name: string | null, symbol: string | null }) {
  // Check for key
  if (privateKey === '') {
    throw new Error('No private key was provided!')
  }

  if (!name || !symbol) {
    const t0State = await token0.getInit()
    const t1State = await token1.getInit()

    const pair = `${t0State.find((i: Value) => i.vname == 'symbol').value}-${t1State.find((i: Value) => i.vname == 'symbol').value}`
    if (!name) name = `ZilSwap V2 ${pair} LP Token`
    if (!symbol) symbol = `ZWAPv2LP.${pair}`
  }

  // Load file and contract initialization variables
  const file: string = `./src/zilswap-v2/contracts/ZilSwapPool.scilla`
  const init: Value[] = [
    // this parameter is mandatory for all init arrays
    {
      vname: '_scilla_version',
      type: 'Uint32',
      value: '0',
    },
    {
      vname: 'init_token0',
      type: 'ByStr20',
      value: token0.address!.toLowerCase(),
    },
    {
      vname: 'init_token1',
      type: 'ByStr20',
      value: token1.address!.toLowerCase(),
    },
    {
      vname: 'init_factory',
      type: 'ByStr20',
      value: router.address!.toLowerCase(),
    },
    {
      vname: 'init_amp_bps',
      type: 'Uint128',
      value: init_amp_bps.toString(),
    },
    {
      vname: 'contract_owner',
      type: 'ByStr20',
      value: router.address!.toLowerCase(),
    },
    {
      vname: 'name',
      type: 'String',
      value: name,
    },
    {
      vname: 'symbol',
      type: 'String',
      value: symbol,
    },
    {
      vname: 'decimals',
      type: 'Uint32',
      value: '12',
    },
    {
      vname: 'init_supply',
      type: 'Uint128',
      value: '0',
    },
  ];
  console.log(init)

  console.info(`Deploying zilswap-v2 pool...`)
  return deployContract(privateKey, file, init)
}

export async function deployFungibleToken(privateKey: string, { name = 'ZS Test Token', symbol: _symbol = null, decimals = 12, supply = new BN('100000000000000000000000000000000000000') } = {}) {
  // Check for key
  if (privateKey === '') {
    throw new Error('No private key was provided!')
  }

  // Generate default vars
  const address = getAddressFromPrivateKey(privateKey)
  const symbol = _symbol || `TEST-${randomHex(4).toUpperCase()}`

  // Load file and contract initialization variables
  const file = "./src/zilswap-v2/contracts/FungibleToken.scilla"
  const init = [
    // this parameter is mandatory for all init arrays
    {
      vname: '_scilla_version',
      type: 'Uint32',
      value: '0',
    },
    {
      vname: 'contract_owner',
      type: 'ByStr20',
      value: `${address}`,
    },
    {
      vname: 'name',
      type: 'String',
      value: `${name}`,
    },
    {
      vname: 'symbol',
      type: 'String',
      value: `${symbol}`,
    },
    {
      vname: 'decimals',
      type: 'Uint32',
      value: decimals.toString(),
    },
    {
      vname: 'init_supply',
      type: 'Uint128',
      value: supply.toString(),
    }
  ];

  console.info(`Deploying fungible token ${symbol}...`)
  return deployContract(privateKey, file, init)
}

export async function useFungibleToken(privateKey: string, params: undefined, approveContractAddress: string | null = null) {
  const [contract, state] = await deployFungibleToken(privateKey, params)

  if (!!approveContractAddress) {
    const address = getAddressFromPrivateKey(privateKey).toLowerCase()
    const allowance = new BigNumber(state.allowances[address] ? state.allowances[address][approveContractAddress.toLowerCase()] : 0)
    if (allowance.isNaN() || allowance.eq(0)) {
      await callContract(
        privateKey, contract,
        'IncreaseAllowance',
        [
          {
            vname: 'spender',
            type: 'ByStr20',
            value: approveContractAddress,
          },
          {
            vname: 'amount',
            type: 'Uint128',
            value: state.total_supply.toString(),
          },
        ],
        0, false, false
      )
      return [contract, await contract.getState()]
    }
  }

  return [contract, state]
}