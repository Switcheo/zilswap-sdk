[zilswap-sdk](../README.md) / [Exports](../modules.md) / index

# Module: index

## Table of contents

### References

- [Zilo](index.md#zilo)

### Classes

- [Zilswap](../classes/index.zilswap.md)

### Type aliases

- [AppState](index.md#appstate)
- [ContractState](index.md#contractstate)
- [ObservedTx](index.md#observedtx)
- [OnUpdate](index.md#onupdate)
- [Options](index.md#options)
- [Pool](index.md#pool)
- [Rates](index.md#rates)
- [TokenDetails](index.md#tokendetails)
- [TxParams](index.md#txparams)
- [TxReceipt](index.md#txreceipt)
- [TxStatus](index.md#txstatus)
- [WalletProvider](index.md#walletprovider)

## References

### Zilo

Renames and exports: [zilo](zilo.md)

## Type aliases

### AppState

Ƭ **AppState**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `contractState` | [ContractState](index.md#contractstate) |
| `currentBalance` | `BigNumber` \| ``null`` |
| `currentNonce` | `number` \| ``null`` |
| `currentUser` | `string` \| ``null`` |
| `pools` | { [key in string]?: Pool} |
| `tokens` | { [key in string]: TokenDetails} |

#### Defined in

[index.ts:64](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L64)

___

### ContractState

Ƭ **ContractState**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `balances` | { [key in string]?: { [key2 in string]?: string}} |
| `output_after_fee` | `string` |
| `pools` | { [key in string]?: object} |
| `total_contributions` | { [key in string]?: string} |

#### Defined in

[index.ts:57](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L57)

___

### ObservedTx

Ƭ **ObservedTx**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `deadline` | `number` |
| `hash` | `string` |

#### Defined in

[index.ts:28](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L28)

___

### OnUpdate

Ƭ **OnUpdate**: (`tx`: [ObservedTx](index.md#observedtx), `status`: [TxStatus](index.md#txstatus), `receipt?`: [TxReceipt](index.md#txreceipt)) => `void`

#### Type declaration

▸ (`tx`, `status`, `receipt?`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `tx` | [ObservedTx](index.md#observedtx) |
| `status` | [TxStatus](index.md#txstatus) |
| `receipt?` | [TxReceipt](index.md#txreceipt) |

##### Returns

`void`

#### Defined in

[index.ts:26](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L26)

___

### Options

Ƭ **Options**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `deadlineBuffer?` | `number` |
| `gasLimit?` | `number` |
| `gasPrice?` | `number` |
| `rpcEndpoint?` | `string` |

#### Defined in

[index.ts:19](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L19)

___

### Pool

Ƭ **Pool**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `contributionPercentage` | `BigNumber` |
| `exchangeRate` | `BigNumber` |
| `tokenReserve` | `BigNumber` |
| `totalContribution` | `BigNumber` |
| `userContribution` | `BigNumber` |
| `zilReserve` | `BigNumber` |

#### Defined in

[index.ts:73](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L73)

___

### Rates

Ƭ **Rates**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `expectedAmount` | `BigNumber` |
| `slippage` | `BigNumber` |

#### Defined in

[index.ts:82](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L82)

___

### TokenDetails

Ƭ **TokenDetails**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `address` | `string` |
| `contract` | `Contract` |
| `decimals` | `number` |
| `hash` | `string` |
| `registered` | `boolean` |
| `symbol` | `string` |
| `whitelisted` | `boolean` |

#### Defined in

[index.ts:47](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L47)

___

### TxParams

Ƭ **TxParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `gasLimit` | `Long` |
| `gasPrice` | `BN` |
| `version` | `number` |

#### Defined in

[index.ts:41](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L41)

___

### TxReceipt

Ƭ **TxReceipt**: `\_TxReceipt`

#### Defined in

[index.ts:39](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L39)

___

### TxStatus

Ƭ **TxStatus**: ``"confirmed"`` \| ``"rejected"`` \| ``"expired"``

#### Defined in

[index.ts:37](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L37)

___

### WalletProvider

Ƭ **WalletProvider**: `Omit`<`Zilliqa` & { `wallet`: `Wallet` & { `defaultAccount`: { `base16`: `string` ; `bech32`: `string`  } ; `net`: `string`  }  }, ``"subscriptionBuilder"``\>

#### Defined in

[index.ts:87](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/index.ts#L87)
