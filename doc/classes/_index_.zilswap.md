[zilswap-sdk](../README.md) › [Globals](../globals.md) › ["index"](../modules/_index_.md) › [Zilswap](_index_.zilswap.md)

# Class: Zilswap

## Hierarchy

* **Zilswap**

## Index

### Constructors

* [constructor](_index_.zilswap.md#constructor)

### Properties

* [contract](_index_.zilswap.md#readonly-contract)
* [contractAddress](_index_.zilswap.md#readonly-contractaddress)
* [contractHash](_index_.zilswap.md#readonly-contracthash)
* [network](_index_.zilswap.md#readonly-network)

### Methods

* [addLiquidity](_index_.zilswap.md#addliquidity)
* [addToken](_index_.zilswap.md#addtoken)
* [approveTokenTransferIfRequired](_index_.zilswap.md#approvetokentransferifrequired)
* [getAppState](_index_.zilswap.md#getappstate)
* [getObservedTxs](_index_.zilswap.md#getobservedtxs)
* [getPool](_index_.zilswap.md#getpool)
* [getRatesForInput](_index_.zilswap.md#getratesforinput)
* [getRatesForOutput](_index_.zilswap.md#getratesforoutput)
* [initialize](_index_.zilswap.md#initialize)
* [observeTx](_index_.zilswap.md#observetx)
* [removeLiquidity](_index_.zilswap.md#removeliquidity)
* [setDeadlineBlocks](_index_.zilswap.md#setdeadlineblocks)
* [swapWithExactInput](_index_.zilswap.md#swapwithexactinput)
* [swapWithExactOutput](_index_.zilswap.md#swapwithexactoutput)
* [teardown](_index_.zilswap.md#teardown)
* [toUnit](_index_.zilswap.md#tounit)
* [toUnitless](_index_.zilswap.md#tounitless)

### Object literals

* [_txParams](_index_.zilswap.md#readonly-_txparams)

## Constructors

###  constructor

\+ **new Zilswap**(`network`: [Network](../enums/_constants_.network.md), `walletProviderOrKey?`: [WalletProvider](../modules/_index_.md#walletprovider) | string, `options?`: [Options](../modules/_index_.md#options)): *[Zilswap](_index_.zilswap.md)*

*Defined in [index.ts:116](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L116)*

Creates the Zilswap SDK object. {@linkcode initalize} needs to be called after
the object is created to begin watching the blockchain's state.

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`network` | [Network](../enums/_constants_.network.md) | the Network to use, either `TestNet` or `MainNet`. |
`walletProviderOrKey?` | [WalletProvider](../modules/_index_.md#walletprovider) &#124; string | a Provider with Wallet or private key string to be used for signing txns. |
`options?` | [Options](../modules/_index_.md#options) | a set of Options that will be used for all txns.  |

**Returns:** *[Zilswap](_index_.zilswap.md)*

## Properties

### `Readonly` contract

• **contract**: *Contract*

*Defined in [index.ts:107](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L107)*

___

### `Readonly` contractAddress

• **contractAddress**: *string*

*Defined in [index.ts:108](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L108)*

___

### `Readonly` contractHash

• **contractHash**: *string*

*Defined in [index.ts:109](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L109)*

___

### `Readonly` network

• **network**: *[Network](../enums/_constants_.network.md)*

*Defined in [index.ts:126](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L126)*

the Network to use, either `TestNet` or `MainNet`.

## Methods

###  addLiquidity

▸ **addLiquidity**(`tokenID`: string, `zilsToAddStr`: string, `tokensToAddStr`: string, `maxExchangeRateChange`: number): *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

*Defined in [index.ts:452](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L452)*

Adds liquidity to the pool with the given `tokenID`. The given `zilsToAddHuman` represents the exact quantity of ZIL
that will be contributed, while the given `tokensToAddHuman` represents the target quantity of ZRC-2 tokens to be
contributed.

To ensure the liquidity contributor does not lose value to arbitrage, the target token amount should be strictly
derived from the current exchange rate that can be found using [`getPool`](_index_.zilswap.md#getpool).

The maximum fluctuation in exchange rate from the given parameters can be controlled through `maxExchangeRateChange`,
to protect against changes in pool reserves between the txn submission and txn confirmation on the Zilliqa blockchain.

If the pool has no liquidity yet, the token amount given will be the exact quantity of tokens that will be contributed,
and the `maxExchangeRateChange` is ignored.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

Note that all amounts should be given with decimals in it's human represented form, rather than as a unitless integer.

**Parameters:**

Name | Type | Default | Description |
------ | ------ | ------ | ------ |
`tokenID` | string | - | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |
`zilsToAddStr` | string | - | is the exact amount of zilliqas to contribute to the pool in ZILs as a unitless string. |
`tokensToAddStr` | string | - | is the target amount of tokens to contribute to the pool as a unitless string. |
`maxExchangeRateChange` | number | 200 | is the maximum allowed exchange rate flucuation given in [basis points](https://www.investopedia.com/terms/b/basispoint.asp). Defaults to 200 = 2.00% if not provided.  |

**Returns:** *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

___

###  addToken

▸ **addToken**(`tokenAddress`: string): *Promise‹boolean›*

*Defined in [index.ts:340](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L340)*

Adds a token which is not already loaded by the default tokens file to the SDK.

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`tokenAddress` | string | is the token address in base16 (0x...) or bech32 (zil...) form.  |

**Returns:** *Promise‹boolean›*

true if the token could be found, or false otherwise.

___

###  approveTokenTransferIfRequired

▸ **approveTokenTransferIfRequired**(`tokenID`: string, `amountStrOrBN`: BigNumber | string): *Promise‹[ObservedTx](../modules/_index_.md#observedtx) | null›*

*Defined in [index.ts:372](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L372)*

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

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`tokenID` | string | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |
`amountStrOrBN` | BigNumber &#124; string | is the required allowance amount the Zilswap contract requires, below which the `IncreaseAllowance` transition is invoked, as a unitless string or BigNumber.  |

**Returns:** *Promise‹[ObservedTx](../modules/_index_.md#observedtx) | null›*

an ObservedTx if IncreaseAllowance was called, null if not.

___

###  getAppState

▸ **getAppState**(): *[AppState](../modules/_index_.md#appstate)*

*Defined in [index.ts:193](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L193)*

Gets the latest Zilswap app state.

**Returns:** *[AppState](../modules/_index_.md#appstate)*

___

###  getObservedTxs

▸ **getObservedTxs**(): *Promise‹[ObservedTx](../modules/_index_.md#observedtx)[]›*

*Defined in [index.ts:217](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L217)*

Gets the currently observed transactions.

**Returns:** *Promise‹[ObservedTx](../modules/_index_.md#observedtx)[]›*

___

###  getPool

▸ **getPool**(`tokenID`: string): *[Pool](../modules/_index_.md#pool) | null*

*Defined in [index.ts:207](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L207)*

Gets the pool details for the given `tokenID`.

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`tokenID` | string | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |

**Returns:** *[Pool](../modules/_index_.md#pool) | null*

if pool exists, or `null` otherwise.

___

###  getRatesForInput

▸ **getRatesForInput**(`tokenInID`: string, `tokenOutID`: string, `tokenInAmountStr`: string): *[Rates](../modules/_index_.md#rates)*

*Defined in [index.ts:267](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L267)*

Gets the expected output amount and slippage for a particular set of ZRC-2 or ZIL tokens at the given input amount.

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`tokenInID` | string | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenOutID` | string | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenInAmountStr` | string | is the exact amount of tokens to be sent to Zilswap as a unitless representable string (without decimals).  |

**Returns:** *[Rates](../modules/_index_.md#rates)*

___

###  getRatesForOutput

▸ **getRatesForOutput**(`tokenInID`: string, `tokenOutID`: string, `tokenOutAmountStr`: string): *[Rates](../modules/_index_.md#rates)*

*Defined in [index.ts:289](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L289)*

Gets the expected input amount and slippage for a particular set of ZRC-2 or ZIL tokens at the given output amount.
Returns NaN values if the given output amount is larger than the pool reserve.

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`tokenInID` | string | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenOutID` | string | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenOutAmountStr` | string | is the exact amount of tokens to be received from Zilswap as a unitless representable string (without decimals).  |

**Returns:** *[Rates](../modules/_index_.md#rates)*

___

###  initialize

▸ **initialize**(`subscription?`: [OnUpdate](../modules/_index_.md#onupdate), `observeTxs`: [ObservedTx](../modules/_index_.md#observedtx)[]): *Promise‹void›*

*Defined in [index.ts:161](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L161)*

Intializes the SDK, fetching a cache of the Zilswap contract state and
subscribing to subsequent state changes. You may optionally pass an array
of ObservedTx's to subscribe to status changes on any of those txs.

**Parameters:**

Name | Type | Default | Description |
------ | ------ | ------ | ------ |
`subscription?` | [OnUpdate](../modules/_index_.md#onupdate) | - | is the callback function to call when a tx state changes. |
`observeTxs` | [ObservedTx](../modules/_index_.md#observedtx)[] | [] | - |

**Returns:** *Promise‹void›*

___

###  observeTx

▸ **observeTx**(`observedTx`: [ObservedTx](../modules/_index_.md#observedtx)): *Promise‹void›*

*Defined in [index.ts:325](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L325)*

Observes the given transaction until the deadline block.

Calls the `OnUpdate` callback given during `initialize` with the updated ObservedTx
when a change has been observed.

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`observedTx` | [ObservedTx](../modules/_index_.md#observedtx) | is the txn hash of the txn to observe with the deadline block number.  |

**Returns:** *Promise‹void›*

___

###  removeLiquidity

▸ **removeLiquidity**(`tokenID`: string, `contributionAmount`: string, `maxExchangeRateChange`: number): *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

*Defined in [index.ts:552](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L552)*

Removes `contributionAmount` worth of liquidity from the pool with the given `tokenID`.

The current user's contribution can be fetched in [`getPool`](_index_.zilswap.md#getpool), and the expected returned amounts at the
current prevailing exchange rates can be calculated by prorating the liquidity pool reserves by the fraction of
the user's current contribution against the pool's total contribution.

The maximum fluctuation in exchange rate from the given parameters can be controlled through `maxExchangeRateChange`,
to protect against changes in pool reserves between the txn submission and txn confirmation on the Zilliqa blockchain.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

**Parameters:**

Name | Type | Default | Description |
------ | ------ | ------ | ------ |
`tokenID` | string | - | is the token ID for the pool, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). |
`contributionAmount` | string | - | is the exact amount of zilliqas to contribute to the pool in ZILs as a string. |
`maxExchangeRateChange` | number | 200 | is the maximum allowed exchange rate flucuation given in [basis points](https://www.investopedia.com/terms/b/basispoint.asp). Defaults to 200 = 2.00% if not provided.  |

**Returns:** *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

___

###  setDeadlineBlocks

▸ **setDeadlineBlocks**(`bufferBlocks`: number): *void*

*Defined in [index.ts:310](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L310)*

Sets the number of blocks to use as the allowable buffer duration before transactions
are considered invalid.

When a transaction is signed, the deadline block by adding the buffer blocks to
the latest confirmed block height.

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`bufferBlocks` | number | is the number of blocks to use as buffer for the deadline block.  |

**Returns:** *void*

___

###  swapWithExactInput

▸ **swapWithExactInput**(`tokenInID`: string, `tokenOutID`: string, `tokenInAmountStr`: string, `maxAdditionalSlippage`: number, `recipientAddress`: string | null): *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

*Defined in [index.ts:653](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L653)*

Swaps ZIL or a ZRC-2 token with `tokenInID` for a corresponding ZIL or ZRC-2 token with `tokenOutID`.

The exact amount of ZIL or ZRC-2 to be sent in (sold) is `tokenInAmountHuman`. The amount received is determined by the prevailing
exchange rate at the current AppState. The expected amount to be received can be given fetched by getExpectedOutput (NYI).

The maximum additional slippage incurred due to fluctuations in exchange rate from when the
transaction is signed and when it is processed by the Zilliqa blockchain can be bounded by the
`maxAdditionalSlippage` variable.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

**Parameters:**

Name | Type | Default | Description |
------ | ------ | ------ | ------ |
`tokenInID` | string | - | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenOutID` | string | - | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenInAmountStr` | string | - | is the exact amount of tokens to be sent to Zilswap as a unitless string (without decimals). |
`maxAdditionalSlippage` | number | 200 | is the maximum additional slippage (on top of slippage due to constant product formula) that the transition will allow before reverting. |
`recipientAddress` | string &#124; null | null | is an optional recipient address for receiving the output of the swap in base16 (0x...) or bech32 (zil...). Defaults to the sender address if `null` or undefined.  |

**Returns:** *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

___

###  swapWithExactOutput

▸ **swapWithExactOutput**(`tokenInID`: string, `tokenOutID`: string, `tokenOutAmountStr`: string, `maxAdditionalSlippage`: number, `recipientAddress`: string | null): *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

*Defined in [index.ts:823](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L823)*

Swaps ZIL or a ZRC-2 token with `tokenInID` for a corresponding ZIL or ZRC-2 token with `tokenOutID`.

The exact amount of ZIL or ZRC-2 to be received (bought) is `tokenOutAmountHuman`. The amount sent is determined by the prevailing
exchange rate at the current AppState. The expected amount to be sent can be given fetched by getExpectedInput (NYI).

The maximum additional slippage incurred due to fluctuations in exchange rate from when the
transaction is signed and when it is processed by the Zilliqa blockchain can be bounded by the
`maxAdditionalSlippage` variable.

The transaction is added to the list of observedTxs, and the observer will be notified on change in tx status.

**Parameters:**

Name | Type | Default | Description |
------ | ------ | ------ | ------ |
`tokenInID` | string | - | is the token ID to be sent to Zilswap (sold), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenOutID` | string | - | is the token ID to be taken from Zilswap (bought), which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`tokenOutAmountStr` | string | - | is the exact amount of tokens to be received from Zilswap as a unitless string (withoout decimals). |
`maxAdditionalSlippage` | number | 200 | is the maximum additional slippage (on top of slippage due to constant product formula) that the transition will allow before reverting. |
`recipientAddress` | string &#124; null | null | is an optional recipient address for receiving the output of the swap in base16 (0x...) or bech32 (zil...). Defaults to the sender address if `null` or undefined.  |

**Returns:** *Promise‹[ObservedTx](../modules/_index_.md#observedtx)›*

___

###  teardown

▸ **teardown**(): *Promise‹void›*

*Defined in [index.ts:173](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L173)*

Stops watching the Zilswap contract state.

**Returns:** *Promise‹void›*

___

###  toUnit

▸ **toUnit**(`tokenID`: string, `amountStr`: string): *string*

*Defined in [index.ts:249](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L249)*

Converts an amount to it's human representation (with decimals based on token contract, or 12 decimals for ZIL)
from it's unitless representation (integer, no decimals).

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`tokenID` | string | is the token ID related to the conversion amount, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`amountStr` | string | is the unitless amount as a string (e.g. 42000000000000 for 42 ZILs) to be converted.  |

**Returns:** *string*

___

###  toUnitless

▸ **toUnitless**(`tokenID`: string, `amountHuman`: string): *string*

*Defined in [index.ts:233](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L233)*

Converts an amount to it's unitless representation (integer, no decimals) from it's
human representation (with decimals based on token contract, or 12 decimals for ZIL).

**Parameters:**

Name | Type | Description |
------ | ------ | ------ |
`tokenID` | string | is the token ID related to the conversion amount, which can be given by either it's symbol (defined in constants.ts), hash (0x...) or bech32 address (zil...). The hash for ZIL is represented by the ZIL_HASH constant. |
`amountHuman` | string | is the amount as a human string (e.g. 4.2 for 4.2 ZILs) to be converted.  |

**Returns:** *string*

## Object literals

### `Readonly` _txParams

### ▪ **_txParams**: *object*

*Defined in [index.ts:112](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L112)*

###  gasLimit

• **gasLimit**: *Long* = Long.fromNumber(30000)

*Defined in [index.ts:115](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L115)*

###  gasPrice

• **gasPrice**: *BN‹›* = toPositiveQa(1000, units.Units.Li)

*Defined in [index.ts:114](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L114)*

###  version

• **version**: *number* = -1

*Defined in [index.ts:113](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L113)*
