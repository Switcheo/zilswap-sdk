[zilswap-sdk](../README.md) / [Exports](../modules.md) / utils

# Module: utils

## Table of contents

### Functions

- [contractInitToMap](utils.md#contractinittomap)
- [isLocalStorageAvailable](utils.md#islocalstorageavailable)
- [toPositiveQa](utils.md#topositiveqa)
- [unitlessBigNumber](utils.md#unitlessbignumber)

## Functions

### contractInitToMap

▸ `Const` **contractInitToMap**(`params`): `Object`

Converts `Value[]` array to map of string values.
`Value.type` is ignored, all values are returned as string.

sample input:
```javascript
 [{
   name: 'address',
   type: 'ByStr20',
   value: '0xbadbeef',
 }, {
   name: 'balance',
   type: 'UInt28',
   value: '100000000',
 }]
```

output:
```javascript
 {
   address: '0xbadbeef',
   balance: '100000000',
 }
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `params` | `Value`[] | parameters in `Value[]` array representation |

#### Returns

`Object`

mapped object representation - refer to sample output

#### Defined in

[utils.ts:150](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/utils.ts#L150)

___

### isLocalStorageAvailable

▸ `Const` **isLocalStorageAvailable**(): `boolean`

#### Returns

`boolean`

#### Defined in

[utils.ts:100](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/utils.ts#L100)

___

### toPositiveQa

▸ `Const` **toPositiveQa**(`input`, `unitOrDecimals`): `BN`

#### Parameters

| Name | Type |
| :------ | :------ |
| `input` | `string` \| `number` \| `BN` |
| `unitOrDecimals` | `number` \| `Zil` \| `Li` \| `Qa` |

#### Returns

`BN`

#### Defined in

[utils.ts:40](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/utils.ts#L40)

___

### unitlessBigNumber

▸ `Const` **unitlessBigNumber**(`str`): `BigNumber`

#### Parameters

| Name | Type |
| :------ | :------ |
| `str` | `string` |

#### Returns

`BigNumber`

#### Defined in

[utils.ts:32](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/utils.ts#L32)
