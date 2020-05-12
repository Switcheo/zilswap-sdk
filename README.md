# Zilswap Typescript SDK

## Setup

Install from github:

`npm install Switcheo/zilswap-sdk#master`

## SDK Usage

Initialize the sdk based on the required network and call required transitions using human strings for token symbol and numbers.

```ts
  import { Zilswap } from 'Switcheo/zilswap-sdk'

  const zilswap = new Zilswap(Network.TestNet)
  await zilswap.addLiquidity('ITN', '0.42', '0.42')
```

## Test Usage

1. Ensure enough tokens minted to your address
2. Run `PRIVATE_KEY=xxx yarn run test`
