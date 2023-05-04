const {
  pedersenHashBinding,
  pedersenHashOnVecBinding,
} = require("./src/helpers/FFI");
const { pedersen, computeHashOnElements } = require("./src/helpers/pedersen");

let a = 123n;
let b = 456n;

console.time("pedersen");
let hash = pedersen([a, b]);
console.timeEnd("pedersen");

console.time("pedersenHashBinding");
let hash2 = pedersenHashBinding(a, b);
console.timeEnd("pedersenHashBinding");

console.time("computeHashOnElements");
hash = computeHashOnElements([a, b, a, b]);
console.timeEnd("computeHashOnElements");

console.time("pedersenHashOnVecBinding");
hash2 = pedersenHashOnVecBinding([a, b, a, b]);
console.timeEnd("pedersenHashOnVecBinding");

console.log(hash);
console.log(hash2);
