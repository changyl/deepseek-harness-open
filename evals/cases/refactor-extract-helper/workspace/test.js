'use strict'

const assert = require('node:assert')
const { totalForMember, totalForGuest } = require('./calculator.js')
const helpers = require('./helpers.js')

assert.strictEqual(totalForMember(100, 2), 180)
assert.strictEqual(totalForGuest(100, 2), 180)
assert.strictEqual(typeof helpers.discountedTotal, 'function')
console.log('PASS')
