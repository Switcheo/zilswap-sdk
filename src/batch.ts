import 'isomorphic-fetch'

export interface BatchRequest {
  id: string
  jsonrpc: string
  method: string
  params: any[]
}

export type BatchResponse = { [key in string]: any }

/**
 * Sends a series of requests as a batch to the Zilliqa API.
 *
 * @param rpcEndpoint The rpc endpoint to query.
 * @param requests[] An array of RPC requests.
 * @returns Promise<{ [key in string]: BatchResponse }> Map of RPC responses keyed by the request ID.
 */
export const sendBatchRequest = async (rpcEndpoint: string, requests: BatchRequest[]): Promise<BatchResponse> => {
  const response = await fetch(rpcEndpoint, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json',
    },
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    body: JSON.stringify(requests),
  })

  const results: BatchResponse[] = await response.json()
  const errors = results
    .map(r => (r.error ? `[${r.id}] ${r.error.message}` : null))
    .filter(e => !!e)
    .join('. ')
  if (errors && errors.length > 0) {
    throw new Error('Failed to send batch request: ' + errors)
  }
  return results.reduce((a, c) => ({ ...a, [c.id]: c.result }), {})
}
