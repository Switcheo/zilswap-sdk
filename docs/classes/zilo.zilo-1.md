[zilswap-sdk](../README.md) / [Exports](../modules.md) / [zilo](../modules/zilo.md) / Zilo

# Class: Zilo

[zilo](../modules/zilo.md)

Zilo class to represent an instance of a ZilSwap Initial Launch Offering.

Usage:
```
const zilswap = new Zilswap(Network.TestNet)
await zilswap.initialize()
const zilo = await zilswap.registerZilo(ZILO_ADDRESS, ziloStateObserver)

const ziloState = zilo.getZiloState()

if (ziloState.state === ILOState.Active) {
   const amount = new BigNumber(1).shiftedBy(ZIL_DECIMALS).toString(10)
   const tx = await zilo.contribute(amount)

   console.log("distribute TX sent", tx.hash)
} else {
   console.log("ZILO not yet active")
}
```

## Table of contents

### Constructors

- [constructor](zilo.zilo-1.md#constructor)

### Methods

- [claim](zilo.zilo-1.md#claim)
- [complete](zilo.zilo-1.md#complete)
- [contribute](zilo.zilo-1.md#contribute)
- [getZiloState](zilo.zilo-1.md#getzilostate)
- [initialize](zilo.zilo-1.md#initialize)
- [updateBlockHeight](zilo.zilo-1.md#updateblockheight)
- [updateObserver](zilo.zilo-1.md#updateobserver)
- [updateZiloState](zilo.zilo-1.md#updatezilostate)

## Constructors

### constructor

• **new Zilo**(`zilswap`, `address`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `zilswap` | [Zilswap](index.zilswap.md) |
| `address` | `string` |

#### Defined in

[zilo.ts:76](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L76)

## Methods

### claim

▸ **claim**(): `Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

Execute claim function if user contributed

#### Returns

`Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

#### Defined in

[zilo.ts:223](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L223)

___

### complete

▸ **complete**(): `Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

#### Returns

`Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

#### Defined in

[zilo.ts:254](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L254)

___

### contribute

▸ **contribute**(`amountToContributeStr`): `Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

Contribute to the ILO, may need to increase token allowance before proceeding

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `amountToContributeStr` | `string` | is the exact amount of ZIL to be contribute as a unitless string (without decimals). |

#### Returns

`Promise`<``null`` \| [ObservedTx](../modules/index.md#observedtx)\>

#### Defined in

[zilo.ts:285](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L285)

___

### getZiloState

▸ **getZiloState**(): [ZiloAppState](../modules/zilo.md#ziloappstate)

#### Returns

[ZiloAppState](../modules/zilo.md#ziloappstate)

#### Defined in

[zilo.ts:178](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L178)

___

### initialize

▸ **initialize**(`observer?`): `Promise`<void\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `observer?` | [OnStateUpdate](../modules/zilo.md#onstateupdate) |

#### Returns

`Promise`<void\>

#### Defined in

[zilo.ts:83](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L83)

___

### updateBlockHeight

▸ **updateBlockHeight**(`height?`): `Promise`<void\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `height?` | `number` |

#### Returns

`Promise`<void\>

#### Defined in

[zilo.ts:160](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L160)

___

### updateObserver

▸ **updateObserver**(`observer?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `observer?` | [OnStateUpdate](../modules/zilo.md#onstateupdate) |

#### Returns

`void`

#### Defined in

[zilo.ts:88](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L88)

___

### updateZiloState

▸ **updateZiloState**(): `Promise`<void\>

#### Returns

`Promise`<void\>

#### Defined in

[zilo.ts:126](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/zilo.ts#L126)
