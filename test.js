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



// Order successful:  65548    Buy
// Order successful:  131084    Buy
// Order successful:  196620    Buy
// Order successful:  262156    Buy
// Order successful:  327692    Sell
// Order successful:  393228    Sell
// Order successful:  458764    Sell
// Order successful:  524300    Sell

// { id: '65548', spendAmount: 3748125000 },
// { id: '131084', spendAmount: 3748049661 },
// { id: '196620', spendAmount: 3747974323 },
// { id: '262156', spendAmount: 3747898985 }
// ],
// '12Sell': [
// { id: '327692', spendAmount: 3750000000 },
// { id: '393228', spendAmount: 3750000000 },
// { id: '458764', spendAmount: 3750000000 },
// { id: '524300', spendAmount: 3750000000 }

