// Import the Rust-generated WebAssembly package
const starkwareCryptoSys = require("../../pkg/starknet");

function pedersen(vec2) {
  let h = starkwareCryptoSys.pedersen_binding(
    vec2[0].toString(),
    vec2[1].toString()
  );

  return BigInt(h);
}

function computeHashOnElements(arr) {
  let h = starkwareCryptoSys.pedersen_on_vec_binding(
    arr.map((x) => x.toString())
  );

  return BigInt(h);
}

module.exports = { pedersen, computeHashOnElements };

// const { pedersenHashBinding, pedersenHashOnVecBinding } = require("./FFI");
// const starknet_hash_utils = require("starknet");
// const pedersen_hash = starknet_hash_utils.hash.pedersen;
// const compute_hash_on_elements = starknet_hash_utils.hash.computeHashOnElements;

// let h = BigInt(pedersen_hash(vec2), 16);
// let h = pedersenHashBinding(vec2[0], vec2[1]);
// let h = BigInt(compute_hash_on_elements(arr), 16);
// let h = pedersenHashOnVecBinding(arr);
