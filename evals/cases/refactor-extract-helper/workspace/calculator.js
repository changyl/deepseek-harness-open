'use strict'

// Two call sites repeat the same discount arithmetic; the new helper belongs
// in helpers.js and both sites must use it.
function totalForMember(price, quantity) {
  const subtotal = price * quantity
  return subtotal - subtotal * 0.1
}

function totalForGuest(price, quantity) {
  const subtotal = price * quantity
  return subtotal - subtotal * 0.1
}

module.exports = { totalForMember, totalForGuest }
