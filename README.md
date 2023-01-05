# Zilswap Typescript SDK

## Setup

Install from npm:

`npm install zilswap-sdk`

## ZILSWAPV1 SDK Usage

Initialize the sdk based on the required network, then call the required methods which will automatically map and call the corresponding smart contract correct transitions.

```ts
  import { Zilswap } from 'zilswap-sdk'

  (async () => {
    const zilswap = new Zilswap(Network.TestNet)
    await zilswap.initialize()
    await zilswap.addLiquidity('SWTH', '42', '42')
    await zilswap.teardown()
  })()
```

### Methods

All public Zilswap methods can be found on the [`Zilswap` SDK object](./docs/classes/index.zilswap.md). 

All public Zilo methods can be found on the [`Zilo` SDK object](./docs/classes/zilo.zilo-1.md). 

Full typescript definitions can also be found in the [Modules](./docs/modules.md).

The following is a list of methods to quickly get you started:

#### Swap & Liquidity

- `approveTokenTransferIfRequired` - approves transfers to zilswap for the given token contract, if the current approval amount is insufficient.
- `addLiquidity` - adds liquidity to the pool
- `removeLiquidity` - removes liquidity to the pool
- `swapWithExactInput` - swaps a token for another token, specifying the exact amount that should be given.
- `swapWithExactOutput` - swaps a token for another token, specifying the exact amount that should be received.

#### Getters

- `getAppState` - gets the current dApp state
- `getPool` - gets the reserve values for a pool
- `getObservedTxs` - gets the txs that the SDK is observing

#### Configuration

- `addToken` - adds a token that is not in the pre-built list
- `observeTx` - observe a zilliqa blockchain tx
- `setDeadlineBlocks` - set the number of blocks before a transition sent by the SDK to expires

#### Helpers

- `toUnitless` - converts a human amount into a unitless integer that is used by Scilla.
- `toUnit` - converts a unitless integer used by scilla into a human readable amount.
- `getRatesForInput` - get the current exchange rates for a pool by giving an input amount.
- `getRatesForOutput` - get the current exchange rates for a pool by giving an output amount.

## ZILSWAPV2 SDK Usage

Initialize the sdk based on the required network, then call the required methods which will automatically map and call the corresponding smart contract correct transitions.

```ts
  import { ZilSwapV2 } from 'zilswap-sdk'

  (async () => {
    const zilswap = new ZilSwapV2(Network.TestNet)
    await zilswap.initialize()
    await zilswap.addLiquidity(tokenAHash, tokenBHash, poolHash, '1000', '1000', '0', '0', 5)
    await zilswap.teardown()
  })()
```

### Methods

All public ZilswapV2 methods can be found on the [`ZilswapV2` SDK object](./docs/classes/index.zilswap.md). 

Full typescript definitions can also be found in the [Modules](./docs/modules.md).

The following is a list of methods to quickly get you started:

#### Swap & Liquidity

- `approveTokenTransferIfRequired` - approves transfers to zilswap for the given token contract, if the current approval amount is insufficient.
- `deployAndAddPool` - Deploys a new pool, and adds to the router
- `deployPool` - Deploys a new pool
- `addPool` - Adds an existing pool to the router
- `addLiquidity` - adds liquidity to the pool
- `addLiquidityZIL` - adds liquidity to the pool, with ZIL as one of the tokens. Contract accepts user's ZIL and wraps it, before transferring to pool
- `removeLiquidity` - removes liquidity to the pool
- `removeLiquidityZIL` - removes liquidity to the pool. Returns ZIL as one of the tokens to the user
- `swapExactTokensForTokens` - swaps a token for another token, specifying the exact amount that should be given.
- `swapTokensForExactTokens` - swaps a token for another token, specifying the exact amount that should be received.
- `swapExactZILForTokens` - swaps ZIL for another token, specifying the exact amount that should be given.
- `swapZILForExactTokens` - swaps ZIL for another token, specifying the exact amount that should be received.
- `swapExactTokensForZIL` - swaps a token for ZIL, specifying the exact amount that should be given.
- `swapTokensForExactZIL` - swaps a token for ZIL, specifying the exact amount that should be received.

#### Getters

- `getAppState` - gets the current dApp state
- `getRouterState` - gets the current router state
- `getPoolStates` - gets the states of all pools on the router
- `getTokenPools` - gets a mapping of tokens to pools
- `getTokens` - gets an array of tokens in the pools, including the pool LP tokens
- `getObservedTxs` - gets the txs that the SDK is observing

#### Configuration

- `observeTx` - observe a zilliqa blockchain tx
- `setDeadlineBlocks` - set the number of blocks before a transition sent by the SDK to expires

#### Helpers

- `toUnitless` - converts a human amount into a unitless integer that is used by Scilla.
- `toUnit` - converts a unitless integer used by scilla into a human readable amount.

## Test Usage

1. Ensure enough tokens minted to your address on testnet
2. Run `PRIVATE_KEY=xxx yarn run test`

## Developing

Generate documentation with typedoc. Install with:

`npm i typedoc typedoc-plugin-markdown --global`

then run:

`typedoc --out ./doc ./src --excludePrivate --plugin typedoc-plugin-markdown`

## Contributing

Please review the [contribution guidelines](docs/CONTRIBUTING.md) before contributing or opening pull requests.
