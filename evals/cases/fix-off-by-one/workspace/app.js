'use strict'

/** Return every integer from `from` up to and including `to`. */
function range(from, to) {
  const out = []
  for (let value = from; value < to; value += 1) out.push(value)
  return out
}

module.exports = { range }
