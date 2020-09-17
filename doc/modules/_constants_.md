[zilswap-sdk](../README.md) › [Globals](../globals.md) › ["constants"](_constants_.md)

# Module: "constants"

## Index

### Enumerations

* [Network](../enums/_constants_.network.md)

### Type aliases

* [Networks](_constants_.md#networks)

### Variables

* [BASIS](_constants_.md#const-basis)
* [ZIL_HASH](_constants_.md#const-zil_hash)

### Object literals

* [APIS](_constants_.md#const-apis)
* [CHAIN_VERSIONS](_constants_.md#const-chain_versions)
* [CONTRACTS](_constants_.md#const-contracts)
* [TOKENS](_constants_.md#const-tokens)
* [WSS](_constants_.md#const-wss)

## Type aliases

###  Networks

Ƭ **Networks**: *keyof typeof Network*

*Defined in [constants.ts:7](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L7)*

## Variables

### `Const` BASIS

• **BASIS**: *10000* = 10000

*Defined in [constants.ts:40](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L40)*

___

### `Const` ZIL_HASH

• **ZIL_HASH**: *"0x0000000000000000000000000000000000000000"* = "0x0000000000000000000000000000000000000000"

*Defined in [constants.ts:42](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L42)*

## Object literals

### `Const` APIS

### ▪ **APIS**: *object*

*Defined in [constants.ts:9](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L9)*

###  [Network.MainNet]

• **[Network.MainNet]**: *string* = "https://api.zilliqa.com"

*Defined in [constants.ts:10](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L10)*

###  [Network.TestNet]

• **[Network.TestNet]**: *string* = "https://dev-api.zilliqa.com"

*Defined in [constants.ts:11](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L11)*

___

### `Const` CHAIN_VERSIONS

### ▪ **CHAIN_VERSIONS**: *object*

*Defined in [constants.ts:35](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L35)*

###  [Network.MainNet]

• **[Network.MainNet]**: *number* = bytes.pack(1, 1)

*Defined in [constants.ts:36](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L36)*

###  [Network.TestNet]

• **[Network.TestNet]**: *number* = bytes.pack(333, 1)

*Defined in [constants.ts:37](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L37)*

___

### `Const` CONTRACTS

### ▪ **CONTRACTS**: *object*

*Defined in [constants.ts:19](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L19)*

###  [Network.MainNet]

• **[Network.MainNet]**: *string* = ""

*Defined in [constants.ts:20](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L20)*

###  [Network.TestNet]

• **[Network.TestNet]**: *string* = "zil1rf3dm8yykryffr94rlrxfws58earfxzu5lw792"

*Defined in [constants.ts:21](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L21)*

___

### `Const` TOKENS

### ▪ **TOKENS**: *object*

*Defined in [constants.ts:24](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L24)*

▪ **[Network.MainNet]**: *object*

*Defined in [constants.ts:25](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L25)*

* **ZIL**: *string* = "zil1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9yf6pz"

▪ **[Network.TestNet]**: *object*

*Defined in [constants.ts:28](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L28)*

* **SWTH**: *string* = "zil1d6yfgycu9ythxy037hkt3phc3jf7h6rfzuft0s"

* **XSGD**: *string* = "zil10a9z324aunx2qj64984vke93gjdnzlnl5exygv"

* **ZIL**: *string* = "zil1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9yf6pz"

___

### `Const` WSS

### ▪ **WSS**: *object*

*Defined in [constants.ts:14](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L14)*

###  [Network.MainNet]

• **[Network.MainNet]**: *string* = "wss://ws.zilliqa.com"

*Defined in [constants.ts:15](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L15)*

###  [Network.TestNet]

• **[Network.TestNet]**: *string* = "wss://dev-ws.zilliqa.com"

*Defined in [constants.ts:16](https://github.com/Switcheo/zilswap-sdk/blob/257cf79/src/constants.ts#L16)*
