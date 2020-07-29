import { bytes } from '@zilliqa-js/util'

export enum Network {
  MainNet = 'MainNet',
  TestNet = 'TestNet',
}
type Networks = keyof typeof Network

export const APIS: { [key in Networks]: string } = {
  [Network.MainNet]: 'https://api.zilliqa.com',
  [Network.TestNet]: 'https://dev-api.zilliqa.com',
}

export const WSS: { [key in Networks]: string } = {
  [Network.MainNet]: 'wss://ws.zilliqa.com',
  [Network.TestNet]: 'wss://dev-ws.zilliqa.com',
}

export const CONTRACTS: { [key in Networks]: string } = {
  [Network.MainNet]: '',
  [Network.TestNet]: 'zil18fh6s7prpm345v8manj3ww5mwfdvdtqg7x3h05',
}

export const TOKENS: { [key in Networks]: { [key2 in string]: string } } = {
  [Network.MainNet]: {
    ZIL: 'zil1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9yf6pz',
  },
  [Network.TestNet]: {
    ZIL: 'zil1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9yf6pz',
    SWTH: 'zil1d6yfgycu9ythxy037hkt3phc3jf7h6rfzuft0s', // Switcheo Test Token
    XSGD: 'zil10a9z324aunx2qj64984vke93gjdnzlnl5exygv', // Xfers SGD
  },
}

export const CHAIN_VERSIONS: { [key in Networks]: number } = {
  [Network.MainNet]: bytes.pack(1, 1),
  [Network.TestNet]: bytes.pack(333, 1),
}

export const BASIS = 10000

export const ZIL_HASH = '0x0000000000000000000000000000000000000000'
