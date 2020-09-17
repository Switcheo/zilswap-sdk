[zilswap-sdk](../README.md) › [Globals](../globals.md) › ["utils"](_utils_.md)

# Module: "utils"

## Index

### Variables

* [unitMap](_utils_.md#const-unitmap)

### Functions

* [numToStr](_utils_.md#const-numtostr)
* [toPositiveQa](_utils_.md#const-topositiveqa)

## Variables

### `Const` unitMap

• **unitMap**: *Map‹Units, string›* = new Map<units.Units, string>([
  [units.Units.Qa, '1'],
  [units.Units.Li, '1000000'], // 1e6 qa
  [units.Units.Zil, '1000000000000'], // 1e12 qa
])

*Defined in [utils.ts:7](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/utils.ts#L7)*

## Functions

### `Const` numToStr

▸ **numToStr**(`input`: string | number | BN): *string*

*Defined in [utils.ts:13](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/utils.ts#L13)*

**Parameters:**

Name | Type |
------ | ------ |
`input` | string &#124; number &#124; BN |

**Returns:** *string*

___

### `Const` toPositiveQa

▸ **toPositiveQa**(`input`: string | number | BN, `unitOrDecimals`: Units | number): *BN‹›*

*Defined in [utils.ts:28](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/utils.ts#L28)*

**Parameters:**

Name | Type |
------ | ------ |
`input` | string &#124; number &#124; BN |
`unitOrDecimals` | Units &#124; number |

**Returns:** *BN‹›*
