import { bytes } from '@zilliqa-js/util'

export enum Network {
  MainNet = 'MainNet',
  TestNet = 'TestNet',
  // LocalHost = 'LocalHost'
}
type Networks = keyof typeof Network

export const APIS: { [key in Networks]: string } = {
  [Network.MainNet]: 'https://api.zilliqa.com',
  [Network.TestNet]: 'https://dev-api.zilliqa.com',
  // [Network.LocalHost]: 'http://localhost:5555',
}

export const WSS: { [key in Networks]: string } = {
  [Network.MainNet]: 'wss://api-ws.zilliqa.com',
  [Network.TestNet]: 'wss://dev-ws.zilliqa.com',
  // [Network.LocalHost]: '',
}

export const ZILSWAPV1_CONTRACTS: { [key in Networks]: string } = {
  [Network.MainNet]: 'zil1gkwt95a67lnpe774lcmz72y6ay4jh2asmmjw6u',
  [Network.TestNet]: 'zil1rf3dm8yykryffr94rlrxfws58earfxzu5lw792',
  // [Network.LocalHost]: '',
}

export const ZILSWAPV2_CONTRACTS: { [key in Networks]: string } = {
  [Network.MainNet]: '',
  [Network.TestNet]: 'zil1207cym7lldlk5xd9397aeakf5vx0q7rtqpp7zr', // IsValidPoolContract commented out
  // [Network.LocalHost]: '',
}

export const ARK_CONTRACTS: { [key in Networks]: string } = {
  [Network.MainNet]: '',
  [Network.TestNet]: 'zil1sgf3zpgt6qeflg053pxjwx9s9pxclx3p7s06gp',
  // [Network.LocalHost]: '',
}

export const WZIL_CONTRACTS: { [key in Networks]: string } = {
  [Network.MainNet]: 'zil1gvr0jgwfsfmxsyx0xsnhtlte4gks6r3yk8x5fn',
  [Network.TestNet]: 'zil19hektxuaehcz50a9yhr4c9n78mfxfqxm9qa58z',
  // [Network.LocalHost]: '',
}

export const WHITELISTED_TOKENS: { [key in Networks]: string[] } = {
  [Network.MainNet]: [
    'zil1gvr0jgwfsfmxsyx0xsnhtlte4gks6r3yk8x5fn', // wZIL
    'zil1p5suryq6q647usxczale29cu3336hhp376c627', // ZWAP
    'zil1zu72vac254htqpg3mtywdcfm84l3dfd9qzww8t', // XSGD
    'zil14pzuzq6v6pmmmrfjhczywguu0e97djepxt8g3e', // gZIL
    'zil1sxx29cshups269ahh5qjffyr58mxjv9ft78jqy', // zUSDT
    'zil1wha8mzaxhm22dpm5cav2tepuldnr8kwkvmqtjq', // zWBTC
    'zil19j33tapjje2xzng7svslnsjjjgge930jx0w09v', // zETH
    'zil1yk93f957fanapf0yszgm84p62xrxxfytj4d2tl', // SWTH
  ],
  [Network.TestNet]: [],
  // [Network.LocalHost]: [],
}

export enum ILOState {
  Uninitialized = 'Uninitialized',
  Pending = 'Pending',
  Active = 'Active',
  Failed = 'Failed',
  Completed = 'Completed',
}

export const CHAIN_VERSIONS: { [key in Networks]: number } = {
  [Network.MainNet]: bytes.pack(1, 1),
  [Network.TestNet]: bytes.pack(333, 1),
  // [Network.LocalHost]: bytes.pack(222, 1),
}

export const BASIS = 10000

export const ZIL_HASH = '0x0000000000000000000000000000000000000000'
