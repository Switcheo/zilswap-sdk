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


export const CONTRACTS : { [key in Networks]: string } = {
  [Network.MainNet]: '',
  [Network.TestNet]: 'zil1saezdfa2xqlc58gq7cwrrypvka3wyfl250fy5n',
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
