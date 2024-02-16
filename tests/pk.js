const { ec, getKeyPair } = require("starknet").ec;

let privKey =
  "0x07e1902be817bf885540800c5cae6d7ff4c6fbf61197404093b6869af194b498";

privKey = BigInt(privKey, 16);
let pubKey = getKeyPair(privKey);

console.log(pubKey.getPublic().getX().toString(16));

// 0x32b3b760040053a3cbfb32956baebd2ebe9b5eea8bd56b2f75191c2e8ffd850
