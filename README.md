# Zilswap Typescript SDK

## Setup

Install from npm:

`npm install zilswap-sdk`

## SDK Usage

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

All public methods can be found on the [`Zilswap` SDK object](./doc/classes/_index_.zilswap.md). Full typescript definitions can also be found in the [doc folder](./doc/README.md).

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

## Test Usage

1. Ensure enough tokens minted to your address on testnet
2. Run `PRIVATE_KEY=xxx yarn run test`

## Developing

Generate documentation with typedoc. Install with:

`npm i typedoc typedoc-plugin-markdown --global`

then run:

`typedoc --out ./doc ./src --excludePrivate --excludeNotExported --plugin typedoc-plugin-markdown`
