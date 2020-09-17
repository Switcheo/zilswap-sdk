[zilswap-sdk](../README.md) › [Globals](../globals.md) › ["index"](_index_.md)

# Module: "index"

## Index

### Classes

* [Zilswap](../classes/_index_.zilswap.md)

### Type aliases

* [AppState](_index_.md#appstate)
* [ContractState](_index_.md#contractstate)
* [ObservedTx](_index_.md#observedtx)
* [OnUpdate](_index_.md#onupdate)
* [Options](_index_.md#options)
* [Pool](_index_.md#pool)
* [Rates](_index_.md#rates)
* [TokenDetails](_index_.md#tokendetails)
* [TxParams](_index_.md#txparams)
* [TxReceipt](_index_.md#txreceipt)
* [TxStatus](_index_.md#txstatus)
* [WalletProvider](_index_.md#walletprovider)

## Type aliases

###  AppState

Ƭ **AppState**: *object*

*Defined in [index.ts:59](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L59)*

#### Type declaration:

* **contractState**: *[ContractState](_index_.md#contractstate)*

* **currentBalance**: *BigNumber | null*

* **currentNonce**: *number | null*

* **currentUser**: *string | null*

* **pools**(): *object*

* **tokens**(): *object*

___

###  ContractState

Ƭ **ContractState**: *object*

*Defined in [index.ts:49](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L49)*

#### Type declaration:

* **_balance**: *string*

* **balances**(): *object*

* **output_after_fee**: *string*

* **owner**: *string*

* **pending_owner**: *string*

* **pools**(): *object*

* **total_contributions**(): *object*

___

###  ObservedTx

Ƭ **ObservedTx**: *object*

*Defined in [index.ts:21](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L21)*

#### Type declaration:

* **deadline**: *number*

* **hash**: *string*

___

###  OnUpdate

Ƭ **OnUpdate**: *function*

*Defined in [index.ts:19](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L19)*

#### Type declaration:

▸ (`tx`: [ObservedTx](_index_.md#observedtx), `status`: [TxStatus](_index_.md#txstatus), `receipt?`: [TxReceipt](_index_.md#txreceipt)): *void*

**Parameters:**

Name | Type |
------ | ------ |
`tx` | [ObservedTx](_index_.md#observedtx) |
`status` | [TxStatus](_index_.md#txstatus) |
`receipt?` | [TxReceipt](_index_.md#txreceipt) |

___

###  Options

Ƭ **Options**: *object*

*Defined in [index.ts:13](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L13)*

#### Type declaration:

* **deadlineBuffer**? : *undefined | number*

* **gasLimit**? : *undefined | number*

* **gasPrice**? : *undefined | number*

___

###  Pool

Ƭ **Pool**: *object*

*Defined in [index.ts:68](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L68)*

#### Type declaration:

* **contributionPercentage**: *BigNumber*

* **exchangeRate**: *BigNumber*

* **tokenReserve**: *BigNumber*

* **totalContribution**: *BigNumber*

* **userContribution**: *BigNumber*

* **zilReserve**: *BigNumber*

___

###  Rates

Ƭ **Rates**: *object*

*Defined in [index.ts:77](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L77)*

#### Type declaration:

* **expectedAmount**: *BigNumber*

* **slippage**: *BigNumber*

___

###  TokenDetails

Ƭ **TokenDetails**: *object*

*Defined in [index.ts:40](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L40)*

#### Type declaration:

* **address**: *string*

* **contract**: *Contract*

* **decimals**: *number*

* **hash**: *string*

* **symbol**: *string*

* **whitelisted**: *boolean*

___

###  TxParams

Ƭ **TxParams**: *object*

*Defined in [index.ts:34](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L34)*

#### Type declaration:

* **gasLimit**: *Long*

* **gasPrice**: *BN*

* **version**: *number*

___

###  TxReceipt

Ƭ **TxReceipt**: *_TxReceipt*

*Defined in [index.ts:32](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L32)*

___

###  TxStatus

Ƭ **TxStatus**: *"confirmed" | "rejected" | "expired"*

*Defined in [index.ts:30](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L30)*

___

###  WalletProvider

Ƭ **WalletProvider**: *Omit‹Zilliqa & object, "subscriptionBuilder"›*

*Defined in [index.ts:82](https://github.com/Switcheo/zilswap-sdk/blob/680cdbe/src/index.ts#L82)*
