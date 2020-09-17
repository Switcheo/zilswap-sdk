[zilswap-sdk](../README.md) › [Globals](../globals.md) › ["test"](_test_.md)

# Module: "test"

## Index

### Variables

* [key](_test_.md#const-key)
* [zilswap](_test_.md#const-zilswap)

### Functions

* [printResults](_test_.md#const-printresults)
* [test](_test_.md#const-test)
* [test2](_test_.md#const-test2)
* [waitForTx](_test_.md#const-waitfortx)

## Variables

### `Const` key

• **key**: *string | undefined* = process.env.PRIVATE_KEY || undefined

*Defined in [test.ts:4](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/test.ts#L4)*

___

### `Const` zilswap

• **zilswap**: *[Zilswap](../classes/_index_.zilswap.md)‹›* = new Zilswap(Network.TestNet, key)

*Defined in [test.ts:5](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/test.ts#L5)*

## Functions

### `Const` printResults

▸ **printResults**(`tx`: [ObservedTx](_index_.md#observedtx), `status`: [TxStatus](_index_.md#txstatus), `receipt?`: [TxReceipt](_index_.md#txreceipt)): *void*

*Defined in [test.ts:159](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/test.ts#L159)*

**Parameters:**

Name | Type |
------ | ------ |
`tx` | [ObservedTx](_index_.md#observedtx) |
`status` | [TxStatus](_index_.md#txstatus) |
`receipt?` | [TxReceipt](_index_.md#txreceipt) |

**Returns:** *void*

___

### `Const` test

▸ **test**(): *Promise‹void›*

*Defined in [test.ts:7](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/test.ts#L7)*

**Returns:** *Promise‹void›*

___

### `Const` test2

▸ **test2**(): *Promise‹void›*

*Defined in [test.ts:83](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/test.ts#L83)*

**Returns:** *Promise‹void›*

___

### `Const` waitForTx

▸ **waitForTx**(): *Promise‹void›*

*Defined in [test.ts:171](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/test.ts#L171)*

**Returns:** *Promise‹void›*
