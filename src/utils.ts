import { Value } from '@zilliqa-js/contract'
import { BN, units } from '@zilliqa-js/util'
import { BigNumber } from 'bignumber.js'

BigNumber.config({ EXPONENTIAL_AT: 1e9 }) // never!

// The following code is based on: @zilliqa-js/util/src/unit.ts.
// toPositiveQa is modified from toQa to accept arbitrary number units,
// while not accepting negative inputs.

const unitMap = new Map<units.Units, string>([
  [units.Units.Qa, '1'],
  [units.Units.Li, '1000000'], // 1e6 qa
  [units.Units.Zil, '1000000000000'], // 1e12 qa
])

const numToStr = (input: string | number | BN) => {
  if (typeof input === 'string') {
    if (!input.match(/^-?[0-9.]+$/)) {
      throw new Error(`while converting number to string, invalid number value '${input}', should be a number matching (^[0-9.]+).`)
    }
    return input
  } else if (typeof input === 'number') {
    return String(input)
  } else if (BN.isBN(input)) {
    return input.toString(10)
  }

  throw new Error(`while converting number to string, invalid number value '${input}' type ${typeof input}.`)
}

export const unitlessBigNumber = (str: string): BigNumber => {
  const bn = new BigNumber(str)
  if (!bn.integerValue().isEqualTo(bn)) {
    throw new Error(`number ${bn} should be unitless (no decimals).`)
  }
  return bn
}

export const toPositiveQa = (input: string | number | BN, unitOrDecimals: units.Units | number) => {
  const inputStr = numToStr(input)

  let base: BN
  let baseNumDecimals: number

  if (typeof unitOrDecimals === 'number') {
    // decimals
    if (unitOrDecimals < 0 || unitOrDecimals % 1 !== 0) {
      throw new Error(`Invalid decimals ${unitOrDecimals}, must be non-negative integer.`)
    }

    baseNumDecimals = unitOrDecimals
    base = new BN(10).pow(new BN(baseNumDecimals))
  } else {
    // unit
    const baseStr = unitMap.get(unitOrDecimals)

    if (!baseStr) {
      throw new Error(`No unit of type ${unitOrDecimals} exists.`)
    }

    baseNumDecimals = baseStr.length - 1
    base = new BN(baseStr, 10)
  }

  if (inputStr === '.') {
    throw new Error(`Cannot convert ${inputStr} to Qa.`)
  }

  // Split it into a whole and fractional part
  const comps = inputStr.split('.')
  if (comps.length > 2) {
    throw new Error(`Cannot convert ${inputStr} to Qa.`)
  }

  let [whole, fraction] = comps

  if (!whole) {
    whole = '0'
  }
  if (!fraction) {
    fraction = '0'
  }
  if (fraction.length > baseNumDecimals) {
    throw new Error(`Cannot convert ${inputStr} to Qa.`)
  }

  while (fraction.length < baseNumDecimals) {
    fraction += '0'
  }

  const wholeBN = new BN(whole)
  const fractionBN = new BN(fraction)
  const qa = wholeBN.mul(base).add(fractionBN)

  return new BN(qa.toString(10), 10)
}

let _lsAvailable: boolean | null = null
export const isLocalStorageAvailable = () => {
  if (_lsAvailable !== null) {
    // only check for ls once
    return _lsAvailable
  }

  _lsAvailable = false
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('ls_feature_test', 'yes')
      if (localStorage.getItem('ls_feature_test') === 'yes') {
        localStorage.removeItem('ls_feature_test')
        _lsAvailable = true
      }
    } catch (e) {
      // fall-through as `false`
    }
  }
  return _lsAvailable
}

/**
 * Converts `Value[]` array to map of string values.
 * `Value.type` is ignored, all values are returned as string.
 *
 *
 * sample input:
 * ```javascript
 *  [{
 *    name: 'address',
 *    type: 'ByStr20',
 *    value: '0xbadbeef',
 *  }, {
 *    name: 'balance',
 *    type: 'UInt28',
 *    value: '100000000',
 *  }]
 * ```
 *
 * output:
 * ```javascript
 *  {
 *    address: '0xbadbeef',
 *    balance: '100000000',
 *  }
 * ```
 *
 * @param params parameters in `Value[]` array representation
 * @returns mapped object representation - refer to sample output
 */
export const contractInitToMap = (params: Value[]): { [index: string]: any } => {
  const output: { [index: string]: any } = {}
  for (const set of params) {
    output[set.vname] = set.value
  }
  return output
}
