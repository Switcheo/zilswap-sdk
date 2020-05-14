import { bytes } from '@zilliqa-js/util'

export enum Network {
  MainNet = "MainNet",
  TestNet = "TestNet",
}
type Networks = keyof typeof Network;

export const APIS : { [key in Networks]: string } = {
  [Network.MainNet]: 'https://api.zilliqa.com',
  [Network.TestNet]: 'https://dev-api.zilliqa.com',
}

export const WSS : { [key in Networks]: string } = {
  [Network.MainNet]: 'wss://ws.zilliqa.com',
  [Network.TestNet]: 'wss://dev-ws.zilliqa.com',
}

export const CONTRACTS : { [key in Networks]: string } = {
  [Network.MainNet]: '',
  [Network.TestNet]: 'zil1k7tvctylv6m84yf4l7wf26k7l6aafuukk63x5a',
}

export const TOKENS : { [key in Networks]: { [key in string]: string } } = {
  [Network.MainNet]: {},
  [Network.TestNet]: {
    ITN: 'zil18zlr57uhrmnk4mfkuawgv0un295k970a9s3lnq', // IToken
  },
}

export const CHAIN_VERSIONS : { [key in Networks]: number } = {
  [Network.MainNet]: bytes.pack(1, 1),
  [Network.TestNet]: bytes.pack(333, 1),
}

export const BASIS = 10000
