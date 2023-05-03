const starknet_hash_utils = require("starknet");
const { pedersenHashBinding, pedersenHashOnVecBinding } = require("./FFI");

/* global BigInt */
const pedersen_hash = starknet_hash_utils.hash.pedersen;
const compute_hash_on_elements = starknet_hash_utils.hash.computeHashOnElements;

function pedersen(vec2) {
  // let h = BigInt(pedersen_hash(vec2), 16);

  let h = pedersenHashBinding(vec2[0], vec2[1]);

  return h;
}

function computeHashOnElements(arr) {
  // let h = BigInt(compute_hash_on_elements(arr), 16);

  let h = pedersenHashOnVecBinding(arr);
  return h;
}

module.exports = { pedersen, computeHashOnElements };
