const { makeDeposits } = require("../../src/helpers");

const { sign, getKeyPair } = require("starknet").ec;

const { PERP_MARKET_IDS_2_TOKENS } = require("invisible-sdk/src/utils");
const { sendPerpOrder } = require("invisible-sdk/src/transactions");

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { UserState } = require("invisible-sdk/src/users");
const { computeHashOnElements } = require("invisible-sdk/src/utils");

const packageDefinition = protoLoader.loadSync("../engine.proto", {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const engine = grpc.loadPackageDefinition(packageDefinition).engine;

const SERVER_URL = "localhost:50052";

let client = new engine.Engine(SERVER_URL, grpc.credentials.createInsecure());

//

async function initMM() {
  let privKey = 101248239572738957238572395803135238950951n;

  //
  await makeDeposits([55555], [20_000], privKey);
}

async function initPosition() {
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  await sendPerpOrder(
    marketMaker,
    "Long",
    1000,
    "Open",
    null,
    54321,
    0.05,
    2350,
    20_000,
    0.07,
    1,
    true,
    null
  );

  console.log("positionData", marketMaker.positionData[54321]);
}

async function registerMM() {
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[syntheticToken][0];
  position.order_side = position.order_side === "Long";

  let posPrivKey =
    marketMaker.positionPrivKeys[position.position_header.position_address];

  let vlpToken = 13579;
  let maxVlpSupply = 1_000_000_000_000;

  // & H = H({position.hash, vlp_token, max_vlp_supply})
  let messageHash = computeHashOnElements([
    position.hash,
    vlpToken,
    maxVlpSupply,
  ]);

  let keyPair = getKeyPair(posPrivKey);
  let sig = sign(keyPair, "0x" + messageHash.toString(16));
  let marketId = 22;

  let registerMessage = {
    position: position,
    vlp_token: vlpToken,
    max_vlp_supply: maxVlpSupply,
    signature: { r: sig[0], s: sig[1] },
    market_id: marketId,
    synthetic_token: syntheticToken,
  };

  await client.register_onchain_mm(registerMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });
}

async function addLiquidity() {
  // ? MARKET MAKER
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[syntheticToken][0];
  position.order_side = position.order_side === "Long";

  let posPrivKey =
    marketMaker.positionPrivKeys[position.position_header.position_address];

  // message OnChainAddLiqReq {
  //   GrpcPerpPosition position = 1;
  //   string depositor = 2;
  //   uint64 initial_value = 3;
  //   Signature signature = 4;
  //   uint32 market_id = 5;
  //   uint32 synthetic_token = 6;
  // }
}

async function removeLiquidity() {
  // ? MARKET MAKER
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  let baseToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[baseToken][0];
  console.log("position before", position);
}

async function main() {
  // await initMM();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // await initPosition();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // await registerMM();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  await addLiquidity();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // await removeLiquidity();
}

main();

// Ok(PerpPosition {
// index: 3, position_header:
// PositionHeader { synthetic_token: 54321, position_address: 2515621936646526414291941246684465506968430707280856084433062674401974871214,
// allow_partial_liquidations: true, vlp_token: 0, max_vlp_supply: 0,

// hash: 1485521988648034206478844620559802264092962755549123833095291387531899750380 }, order_side: Short,
// position_size: 5000000, margin: 19999941345, entry_price: 2320000000, liquidation_price: 0, bankruptcy_price: 0,
// last_funding_idx: 0, vlp_supply: 0, hash: 3339438903260205812244036825303405518899419210941861089465262344458033609107 })

// position before {
//   hash: '619393722529871128088058264914784089171038657038758816997537177050323159895',
//   bankruptcy_price: 0,
//   last_funding_idx: 0,
//   entry_price: 2320000000,
//   order_side: 'Long',
//   position_size: 5000000,
//   index: 3,
//   vlp_supply: 0,
//   position_header: {
//     allow_partial_liquidations: true,
//     vlp_token: 0,
//     synthetic_token: 54321,
//     hash: '1485521988648034206478844620559802264092962755549123833095291387531899750380',
//     position_address: '2515621936646526414291941246684465506968430707280856084433062674401974871214',
//     max_vlp_supply: 0
//   },
//   liquidation_price: 0,
//   margin: 19999941345
// }
