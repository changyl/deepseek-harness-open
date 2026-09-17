'use strict'

// TODO: the port below is hard-coded and no longer matches config.json.
const config = require('./config.json')

function port() {
  return 8080
}

console.log(`port: ${port()}`)
