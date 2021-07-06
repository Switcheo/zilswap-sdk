[zilswap-sdk](../README.md) / [Exports](../modules.md) / [index](../modules/index.md) / Zilswap

# Class: Zilswap

[zilswap](../modules/index.md)

## Table of contents

### Constructors

- [constructor](index.zilswap.md#constructor)

### Properties

- [\_txParams](index.zilswap.md#_txparams)
- [contract](index.zilswap.md#contract)
- [contractAddress](index.zilswap.md#contractaddress)
- [contractHash](index.zilswap.md#contracthash)
- [network](index.zilswap.md#network)
- [zilliqa](index.zilswap.md#zilliqa)
- [zilos](index.zilswap.md#zilos)

### Methods

- [addLiquidity](index.zilswap.md#addliquidity)
- [addToken](index.zilswap.md#addtoken)
- [approveTokenTransferIfRequired](index.zilswap.md#approvetokentransferifrequired)
- [callContract](index.zilswap.md#callcontract)
- [checkAppLoadedWithUser](index.zilswap.md#checkapploadedwithuser)
- [deadlineBlock](index.zilswap.md#deadlineblock)
- [deregisterZilo](index.zilswap.md#deregisterzilo)
- [fetchContractInit](index.zilswap.md#fetchcontractinit)
- [getAppState](index.zilswap.md#getappstate)
- [getContract](index.zilswap.md#getcontract)
- [getCurrentBlock](index.zilswap.md#getcurrentblock)
- [getObservedTxs](index.zilswap.md#getobservedtxs)
- [getPool](index.zilswap.md#getpool)
- [getRatesForInput](index.zilswap.md#getratesforinput)
- [getRatesForOutput](index.zilswap.md#getratesforoutput)
- [initialize](index.zilswap.md#initialize)
- [observeTx](index.zilswap.md#observetx)
- [registerZilo](index.zilswap.md#registerzilo)
- [removeLiquidity](index.zilswap.md#removeliquidity)
- [setDeadlineBlocks](index.zilswap.md#setdeadlineblocks)
- [swapWithExactInput](index.zilswap.md#swapwithexactinput)
- [swapWithExactOutput](index.zilswap.md#swapwithexactoutput)
- [teardown](index.zilswap.md#teardown)
- [toUnit](index.zilswap.md#tounit)
- [toUnitless](index.zilswap.md#tounitless)
- [txParams](index.zilswap.md#txparams)

## Constructors

### constructor

• **new Zilswap**(`network`, `walletProviderOrKey?`, `options?`)

Creates the Zilswap SDK object. {@linkcode initalize} needs to be called after
the object is created to begin watching the blockchain's state.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `network` | [Network](../enums/constants.network.md) | the Network to use, either `TestNet` or `MainNet`. |
| `walletProviderOrKey?` | `string` \| `Pick`<`Zilliqa` & { `wallet`: `Wallet` & { `defaultAccount`: { `base16`: `string` ; `bech32`: `string`  } ; `net`: `string`  }  }, ``"provider"`` \| ``"blockchain"`` \| ``"network"`` \| ``"contracts"`` \| ``"transactions"`` \| ``"wallet"``\> | a Provider with Wallet or private key string to be used for signing txns. |
| `options?` | [Options](../modules/index.md#options) | a set of Options that will be used for all txns. |

#### Defined in

[index.ts:127](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L127)

## Properties

### \_txParams

• `Readonly` **\_txParams**: [TxParams](../modules/index.md#txparams)

#### Defined in

[index.ts:123](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L123)

___

### contract

• `Readonly` **contract**: `Contract`

#### Defined in

[index.ts:115](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L115)

___

### contractAddress

• `Readonly` **contractAddress**: `string`

#### Defined in

[index.ts:116](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L116)

___

### contractHash

• `Readonly` **contractHash**: `string`

#### Defined in

[index.ts:117](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L117)

___

### network

• `Readonly` **network**: [Network](../enums/constants.network.md)

___

### zilliqa

• `Readonly` **zilliqa**: `Zilliqa`

#### Defined in

[index.ts:96](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L96)

___

### zilos

• `Readonly` **zilos**: `Object`

#### Index signature

▪ [address: `string`]: [Zilo](zilo.zilo-1.md)

#### Defined in

[index.ts:120](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L120)

## Methods

### addLiquidity

▸ **addLiquidity**(`tokenID`, `zilsToAddStr`, `tokensToAddStr`, `maxExchangeRateChange?`): `Promise`<[ObservedTx](../modules/index.md#observedtx)\>

Adds liquidity to the pool with the given `tokenID`. The given `zilsToAddHuman` represents the exact quantity of ZIL
that will be contributed, while the given `tokensToAddHuman` represents the target quantity of ZRC-2 tokens to be
contributed.

To ensure the liquidity contributor does not lose value to arbitrage, the target token amount should be strictly
derived from the current exchange rate that can be found using [`getPool`](index.zilswap.md#getpool).

The maximum fluctuation in exchange rate from the given parameters can be controlled through `maxExchangeRateChange`,
to protect against changes in pool reserves between the txn submission and txn confirmation on the Zilliqa blockchain.

If the pool has no liquidity yet, the token amount given will be the exact quantity of tokens that will be contributed,
and the `maxExchangeRateChange` is ignored.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

Note that all amounts should be given with decimals in it's human represented form, rather than as a unitless integer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `tokenID` | `string` | `undefined` | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |
| `zilsToAddStr` | `string` | `undefined` | is the exact amount of zilliqas to contribute to the pool in ZILs as a unitless string. |
| `tokensToAddStr` | `string` | `undefined` | is the target amount of tokens to contribute to the pool as a unitless string. |
| `maxExchangeRateChange` | `number` | 200 | is the maximum allowed exchange rate flucuation given in [basis points](https://www.investopedia.com/terms/b/basispoint.asp). Defaults to 200 = 2.00% if not provided. |

#### Returns

`Promise`<[ObservedTx](../modules/index.md#observedtx)\>

#### Defined in

[index.ts:534](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L534)

___

### addToken

▸ **addToken**(`tokenAddress`): `Promise`<boolean\>

Adds a token which is not already loaded by the default tokens file to the SDK.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tokenAddress` | `string` | is the token address in base16 (0x...) or bech32 (zil...) form. |

#### Returns

`Promise`<boolean\>

true if the token could be found, or false otherwise.

#### Defined in

[index.ts:415](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L415)

___

### approveTokenTransferIfRequired

▸ **approveTokenTransferIfRequired**(`tokenID`, `amountStrOrBN`, `spenderHash?`): `Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

Approves allowing the Zilswap contract to transfer ZRC-2 token with `tokenID`, if the current
approved allowance is less than `amount`. If the allowance is sufficient, this method is a no-op.

The approval is done by calling `IncreaseAllowance` with the allowance amount as the entire
token supply. This is done so that the approval needs to only be done once per token contract,
reducing the number of approval transactions required for users conducting multiple swaps.

Non-custodial control of the token is ensured by the Zilswap contract itself, which does not
allow for the transfer of tokens unless explicitly invoked by the sender.

The transaction is added to the list of observedTxs, and the observer will be notified on
a confirmation or rejection event. The transation will be assumed to be expired after the default
deadline buffer, even though there is no deadline block for this transaction.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tokenID` | `string` | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |
| `amountStrOrBN` | `string` \| `BigNumber` | is the required allowance amount the Zilswap contract requires, below which the `IncreaseAllowance` transition is invoked, as a unitless string or BigNumber. |
| `spenderHash` | `string` | (optional) is the spender contract address, defaults to the ZilSwap contract address. |

#### Returns

`Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

an ObservedTx if IncreaseAllowance was called, null if not.

#### Defined in

[index.ts:451](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L451)

___

### callContract

▸ **callContract**(`contract`, `transition`, `args`, `params`, `toDs?`): `Promise`<Transaction\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `contract` | `Contract` |
| `transition` | `string` |
| `args` | `Value`[] |
| `params` | `Pick`<TxParams, ``"version"`` \| ``"amount"`` \| ``"gasPrice"`` \| ``"gasLimit"`` \| ``"nonce"`` \| ``"pubKey"``\> |
| `toDs?` | `boolean` |

#### Returns

`Promise`<Transaction\>

#### Defined in

[index.ts:1157](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L1157)

___

### checkAppLoadedWithUser

▸ **checkAppLoadedWithUser**(): `void`

#### Returns

`void`

#### Defined in

[index.ts:1546](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L1546)

___

### deadlineBlock

▸ **deadlineBlock**(): `number`

#### Returns

`number`

#### Defined in

[index.ts:1579](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L1579)

___

### deregisterZilo

▸ **deregisterZilo**(`address`): `void`

Deregisters an existing Zilo instance. Does nothing if provided
address is not already registered.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `address` | `string` | is the Zilo contract address which can be given by either hash (0x...) or bech32 address (zil...). |

#### Returns

`void`

#### Defined in

[index.ts:227](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L227)

___

### fetchContractInit

▸ **fetchContractInit**(`contract`): `Promise`<any\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `contract` | `Contract` |

#### Returns

`Promise`<any\>

#### Defined in

[index.ts:1454](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L1454)

___

### getAppState

▸ **getAppState**(): [AppState](../modules/index.md#appstate)

Gets the latest Zilswap app state.

#### Returns

[AppState](../modules/index.md#appstate)

#### Defined in

[index.ts:261](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L261)

___

### getContract

▸ **getContract**(`address`): `Contract`

Gets the contract with the given address that can be called by the default account.

#### Parameters

| Name | Type |
| :------ | :------ |
| `address` | `string` |

#### Returns

`Contract`

#### Defined in

[index.ts:271](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L271)

___

### getCurrentBlock

▸ **getCurrentBlock**(): `number`

#### Returns

`number`

#### Defined in

[index.ts:1575](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L1575)

___

### getObservedTxs

▸ **getObservedTxs**(): `Promise`<[ObservedTx](../modules/index.md#observedtx)[]\>

Gets the currently observed transactions.

#### Returns

`Promise`<[ObservedTx](../modules/index.md#observedtx)[]\>

#### Defined in

[index.ts:292](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L292)

___

### getPool

▸ **getPool**(`tokenID`): ``null`` \| [Pool](../modules/index.md#pool)

Gets the pool details for the given `tokenID`.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tokenID` | `string` | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |

#### Returns

``null`` \| [Pool](../modules/index.md#pool)

if pool exists, or `null` otherwise.

#### Defined in

[index.ts:282](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L282)

___

### getRatesForInput

▸ **getRatesForInput**(`tokenInID`, `tokenOutID`, `tokenInAmountStr`): [Rates](../modules/index.md#rates)

Gets the expected output amount and slippage for a particular set of ZRC-2 or ZIL tokens at the given input amount.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tokenInID` | `string` | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenOutID` | `string` | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenInAmountStr` | `string` | is the exact amount of tokens to be sent to Zilswap as a unitless representable string (without decimals). |

#### Returns

[Rates](../modules/index.md#rates)

#### Defined in

[index.ts:342](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L342)

___

### getRatesForOutput

▸ **getRatesForOutput**(`tokenInID`, `tokenOutID`, `tokenOutAmountStr`): [Rates](../modules/index.md#rates)

Gets the expected input amount and slippage for a particular set of ZRC-2 or ZIL tokens at the given output amount.
Returns NaN values if the given output amount is larger than the pool reserve.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tokenInID` | `string` | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenOutID` | `string` | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenOutAmountStr` | `string` | is the exact amount of tokens to be received from Zilswap as a unitless representable string (without decimals). |

#### Returns

[Rates](../modules/index.md#rates)

#### Defined in

[index.ts:364](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L364)

___

### initialize

▸ **initialize**(`subscription?`, `observeTxs?`): `Promise`<void\>

Intializes the SDK, fetching a cache of the Zilswap contract state and
subscribing to subsequent state changes. You may optionally pass an array
of ObservedTx's to subscribe to status changes on any of those txs.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `subscription?` | [OnUpdate](../modules/index.md#onupdate) | `undefined` | is the callback function to call when a tx state changes. |
| `observeTxs` | [ObservedTx](../modules/index.md#observedtx)[] | [] | - |

#### Returns

`Promise`<void\>

#### Defined in

[index.ts:173](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L173)

___

### observeTx

▸ **observeTx**(`observedTx`): `Promise`<void\>

Observes the given transaction until the deadline block.

Calls the `OnUpdate` callback given during `initialize` with the updated ObservedTx
when a change has been observed.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `observedTx` | [ObservedTx](../modules/index.md#observedtx) | is the txn hash of the txn to observe with the deadline block number. |

#### Returns

`Promise`<void\>

#### Defined in

[index.ts:400](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L400)

___

### registerZilo

▸ **registerZilo**(`address`, `onStateUpdate?`): `Promise`<[Zilo](zilo.zilo-1.md)\>

Initializes a new Zilo instance and registers it to the ZilSwap SDK,
subscribing to subsequent state changes in the Zilo instance. You may
optionally pass a state observer to subscribe to state changes of this
particular Zilo instance.

If the Zilo instance is already registered, no new instance will be
created. If a new state observer is provided, it will overwrite the
existing one.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `address` | `string` | is the Zilo contract address which can be given by either hash (0x...) or bech32 address (zil...). |
| `onStateUpdate?` | [OnStateUpdate](../modules/zilo.md#onstateupdate) | is the state observer which triggers when state updates |

#### Returns

`Promise`<[Zilo](zilo.zilo-1.md)\>

#### Defined in

[index.ts:203](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L203)

___

### removeLiquidity

▸ **removeLiquidity**(`tokenID`, `contributionAmount`, `maxExchangeRateChange?`): `Promise`<[ObservedTx](../modules/index.md#observedtx)\>

Removes `contributionAmount` worth of liquidity from the pool with the given `tokenID`.

The current user's contribution can be fetched in [`getPool`](index.zilswap.md#getpool), and the expected returned amounts at the
current prevailing exchange rates can be calculated by prorating the liquidity pool reserves by the fraction of
the user's current contribution against the pool's total contribution.

The maximum fluctuation in exchange rate from the given parameters can be controlled through `maxExchangeRateChange`,
to protect against changes in pool reserves between the txn submission and txn confirmation on the Zilliqa blockchain.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `tokenID` | `string` | `undefined` | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |
| `contributionAmount` | `string` | `undefined` | is the exact amount of zilliqas to contribute to the pool in ZILs as a string. |
| `maxExchangeRateChange` | `number` | 200 | is the maximum allowed exchange rate flucuation given in [basis points](https://www.investopedia.com/terms/b/basispoint.asp). Defaults to 200 = 2.00% if not provided. |

#### Returns

`Promise`<[ObservedTx](../modules/index.md#observedtx)\>

#### Defined in

[index.ts:634](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L634)

___

### setDeadlineBlocks

▸ **setDeadlineBlocks**(`bufferBlocks`): `void`

Sets the number of blocks to use as the allowable buffer duration before transactions
are considered invalid.

When a transaction is signed, the deadline block by adding the buffer blocks to
the latest confirmed block height.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `bufferBlocks` | `number` | is the number of blocks to use as buffer for the deadline block. |

#### Returns

`void`

#### Defined in

[index.ts:385](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L385)

___

### swapWithExactInput

▸ **swapWithExactInput**(`tokenInID`, `tokenOutID`, `tokenInAmountStr`, `maxAdditionalSlippage?`, `recipientAddress?`): `Promise`<[ObservedTx](../modules/index.md#observedtx)\>

Swaps ZIL or a ZRC-2 token with `tokenInID` for a corresponding ZIL or ZRC-2 token with `tokenOutID`.

The exact amount of ZIL or ZRC-2 to be sent in (sold) is `tokenInAmountHuman`. The amount received is determined by the prevailing
exchange rate at the current AppState. The expected amount to be received can be given fetched by getExpectedOutput (NYI).

The maximum additional slippage incurred due to fluctuations in exchange rate from when the
transaction is signed and when it is processed by the Zilliqa blockchain can be bounded by the
`maxAdditionalSlippage` variable.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `tokenInID` | `string` | `undefined` | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenOutID` | `string` | `undefined` | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenInAmountStr` | `string` | `undefined` | is the exact amount of tokens to be sent to Zilswap as a unitless string (without decimals). |
| `maxAdditionalSlippage` | `number` | 200 | is the maximum additional slippage (on top of slippage due to constant product formula) that the transition will allow before reverting. |
| `recipientAddress` | ``null`` \| `string` | null | is an optional recipient address for receiving the output of the swap in base16 (0x...) or bech32 (zil...). Defaults to the sender address if `null` or undefined. |

#### Returns

`Promise`<[ObservedTx](../modules/index.md#observedtx)\>

#### Defined in

[index.ts:735](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L735)

___

### swapWithExactOutput

▸ **swapWithExactOutput**(`tokenInID`, `tokenOutID`, `tokenOutAmountStr`, `maxAdditionalSlippage?`, `recipientAddress?`): `Promise`<[ObservedTx](../modules/index.md#observedtx)\>

Swaps ZIL or a ZRC-2 token with `tokenInID` for a corresponding ZIL or ZRC-2 token with `tokenOutID`.

The exact amount of ZIL or ZRC-2 to be received (bought) is `tokenOutAmountHuman`. The amount sent is determined by the prevailing
exchange rate at the current AppState. The expected amount to be sent can be given fetched by getExpectedInput (NYI).

The maximum additional slippage incurred due to fluctuations in exchange rate from when the
transaction is signed and when it is processed by the Zilliqa blockchain can be bounded by the
`maxAdditionalSlippage` variable.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `tokenInID` | `string` | `undefined` | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenOutID` | `string` | `undefined` | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `tokenOutAmountStr` | `string` | `undefined` | is the exact amount of tokens to be received from Zilswap as a unitless string (withoout decimals). |
| `maxAdditionalSlippage` | `number` | 200 | is the maximum additional slippage (on top of slippage due to constant product formula) that the transition will allow before reverting. |
| `recipientAddress` | ``null`` \| `string` | null | is an optional recipient address for receiving the output of the swap in base16 (0x...) or bech32 (zil...). Defaults to the sender address if `null` or undefined. |

#### Returns

`Promise`<[ObservedTx](../modules/index.md#observedtx)\>

#### Defined in

[index.ts:905](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L905)

___

### teardown

▸ **teardown**(): `Promise`<void\>

Stops watching the Zilswap contract state.

#### Returns

`Promise`<void\>

#### Defined in

[index.ts:242](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L242)

___

### toUnit

▸ **toUnit**(`tokenID`, `amountStr`): `string`

Converts an amount to it's human representation (with decimals based on token contract, or 12 decimals for ZIL)
from it's unitless representation (integer, no decimals).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tokenID` | `string` | is the token ID related to the conversion amount, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `amountStr` | `string` | is the unitless amount as a string (e.g. 42000000000000 for 42 ZILs) to be converted. |

#### Returns

`string`

#### Defined in

[index.ts:324](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L324)

___

### toUnitless

▸ **toUnitless**(`tokenID`, `amountHuman`): `string`

Converts an amount to it's unitless representation (integer, no decimals) from it's
human representation (with decimals based on token contract, or 12 decimals for ZIL).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `tokenID` | `string` | is the token ID related to the conversion amount, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
| `amountHuman` | `string` | is the amount as a human string (e.g. 4.2 for 4.2 ZILs) to be converted. |

#### Returns

`string`

#### Defined in

[index.ts:308](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L308)

___

### txParams

▸ **txParams**(): [TxParams](../modules/index.md#txparams) & { `nonce`: `number`  }

#### Returns

[TxParams](../modules/index.md#txparams) & { `nonce`: `number`  }

#### Defined in

[index.ts:1568](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L1568)
