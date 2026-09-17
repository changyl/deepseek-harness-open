'use strict'

const assert = require('node:assert')
const { range } = require('./app.js')

assert.deepStrictEqual(range(1, 3), [1, 2, 3])
assert.deepStrictEqual(range(4, 4), [4])
assert.deepStrictEqual(range(3, 1), [])
console.log('PASS')
