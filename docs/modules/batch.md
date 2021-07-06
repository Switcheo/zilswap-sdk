[zilswap-sdk](../README.md) / [Exports](../modules.md) / batch

# Module: batch

## Table of contents

### Interfaces

- [BatchRequest](../interfaces/batch.batchrequest.md)

### Type aliases

- [BatchResponse](batch.md#batchresponse)

### Functions

- [sendBatchRequest](batch.md#sendbatchrequest)

## Type aliases

### BatchResponse

Ƭ **BatchResponse**: { [key in string]: any}

#### Defined in

[batch.ts:10](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/batch.ts#L10)

## Functions

### sendBatchRequest

▸ `Const` **sendBatchRequest**(`rpcEndpoint`, `requests`): `Promise`<[BatchResponse](batch.md#batchresponse)\>

Sends a series of requests as a batch to the Zilliqa API.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `rpcEndpoint` | `string` | The rpc endpoint to query. |
| `requests` | [BatchRequest](../interfaces/batch.batchrequest.md)[] | - |

#### Returns

`Promise`<[BatchResponse](batch.md#batchresponse)\>

Promise<{ [key in string]: BatchResponse }> Map of RPC responses keyed by the request ID.

#### Defined in

[batch.ts:19](https://github.com/Switcheo/zilswap-sdk/blob/67d9128/src/batch.ts#L19)
