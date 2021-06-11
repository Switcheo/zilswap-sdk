[zilswap-sdk](../README.md) / [Exports](../modules.md) / zilo

# Module: zilo

## Table of contents

### Classes

- [Zilo](../classes/zilo.zilo-1.md)

### Type aliases

- [OnStateUpdate](zilo.md#onstateupdate)
- [ZiloAppState](zilo.md#ziloappstate)
- [ZiloContractInit](zilo.md#zilocontractinit)
- [ZiloContractState](zilo.md#zilocontractstate)

## Type aliases

### OnStateUpdate

Ƭ **OnStateUpdate**: (`appState`: [ZiloAppState](zilo.md#ziloappstate)) => `void`

#### Type declaration

▸ (`appState`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `appState` | [ZiloAppState](zilo.md#ziloappstate) |

##### Returns

`void`

#### Defined in

[zilo.ts:14](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L14)

___

### ZiloAppState

Ƭ **ZiloAppState**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `claimable` | `boolean` |
| `contractInit` | [ZiloContractInit](zilo.md#zilocontractinit) \| ``null`` |
| `contractState` | [ZiloContractState](zilo.md#zilocontractstate) |
| `contributed` | `boolean` |
| `currentNonce` | `number` \| ``null`` |
| `currentUser` | `string` \| ``null`` |
| `state` | [ILOState](../enums/constants.ilostate.md) |
| `userContribution` | `BigNumber` |

#### Defined in

[zilo.ts:39](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L39)

___

### ZiloContractInit

Ƭ **ZiloContractInit**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `_creation_block` | `string` |
| `_scilla_version` | `string` |
| `_this_address` | `string` |
| `end_block` | `number` |
| `liquidity_address` | `string` |
| `liquidity_zil_amount` | `BigNumber` |
| `minimum_zil_amount` | `BigNumber` |
| `receiver_address` | `string` |
| `start_block` | `number` |
| `target_zil_amount` | `BigNumber` |
| `target_zwap_amount` | `BigNumber` |
| `token_address` | `string` |
| `token_amount` | `BigNumber` |
| `zwap_address` | `string` |

#### Defined in

[zilo.ts:22](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L22)

___

### ZiloContractState

Ƭ **ZiloContractState**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `contributions` | `Object` |
| `initialized` | `ADTValue` |
| `total_contributions` | `string` |

#### Defined in

[zilo.ts:16](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L16)
