const { pedersen, computeHashOnElements } = require("./src/helpers/pedersen");

// Import the Rust-generated WebAssembly package
const starkwareCryptoSys = require("./pkg/starknet");

const starknet_hash_utils = require("starknet");
const pedersen_hash = starknet_hash_utils.hash.pedersen;

// const { pedersenHashBinding, pedersenHashOnVecBinding } = require("./FFI");
// const starknet_hash_utils = require("starknet");
// const pedersen_hash = starknet_hash_utils.hash.pedersen;
// const compute_hash_on_elements = starknet_hash_utils.hash.computeHashOnElements;

// let h = BigInt(pedersen_hash(vec2), 16);
// let h = pedersenHashBinding(vec2[0], vec2[1]);
// let h = BigInt(compute_hash_on_elements(arr), 16);
// let h = pedersenHashOnVecBinding(arr);

let a = 123459253786237523535892357235532n;
let b = 389625662538953258923568235623533n;

let h = starkwareCryptoSys.pedersen_binding(
  "123459253786237523535892357235532",
  "389625662538953258923568235623533"
);

let check = pedersen_hash([a, b]);

console.log("h: ", h);
console.log("check: ", BigInt(check));
