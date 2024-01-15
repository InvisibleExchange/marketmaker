const { makeDeposits } = require("../../src/helpers");

const { sign, getKeyPair } = require("starknet").ec;

const {
  PERP_MARKET_IDS_2_TOKENS,
  COLLATERAL_TOKEN_DECIMALS,
} = require("invisible-sdk/src/utils");
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

  console.log("position", position);

  let posPrivKey =
    marketMaker.positionPrivKeys[position.position_header.position_address];

  let depositor = 61872278164781256322784325782984327823785n;
  let initial_value = 2000 * 10 ** COLLATERAL_TOKEN_DECIMALS;

  // & header_hash = H({pos_hash, depositor, collateral_amount})
  let messageHash = computeHashOnElements([
    position.hash,
    depositor,
    initial_value,
  ]);

  let keyPair = getKeyPair(posPrivKey);
  let sig = sign(keyPair, "0x" + messageHash.toString(16));
  let marketId = 22;

  let addLiqMessage = {
    position,
    depositor,
    initial_value,
    signature: { r: sig[0], s: sig[1] },
    market_id: marketId,
    synthetic_token: syntheticToken,
  };

  await client.add_liquidity_mm(addLiqMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });
}

async function removeLiquidity() {
  // ? MARKET MAKER
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[syntheticToken][0];
  position.order_side = position.order_side === "Long";

  console.log("position", position);

  let posPrivKey =
    marketMaker.positionPrivKeys[position.position_header.position_address];

  let depositor = 61872278164781256322784325782984327823785n;
  let initial_value = 2000 * 10 ** COLLATERAL_TOKEN_DECIMALS;
  let vlp_amount = initial_value;

  // & hash = H({position.hash, depositor, intial_value, vlp_amount})
  let messageHash = computeHashOnElements([
    position.hash,
    depositor,
    initial_value,
    vlp_amount,
  ]);

  let keyPair = getKeyPair(posPrivKey);
  let sig = sign(keyPair, "0x" + messageHash.toString(16));
  let marketId = 22;

  let removeLiqMessage = {
    position,
    depositor,
    initial_value,
    vlp_amount,
    signature: { r: sig[0], s: sig[1] },
    market_id: marketId,
    synthetic_token: syntheticToken,
  };

  await client.remove_liquidity_mm(removeLiqMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });
}

async function closeMM() {
  // ? MARKET MAKER
  let privKey = 101248239572738957238572395803135238950951n;
  let marketMaker = await UserState.loginUser(privKey);

  let syntheticToken = PERP_MARKET_IDS_2_TOKENS[22];
  let position = marketMaker.positionData[syntheticToken][0];
  position.order_side = position.order_side === "Long";

  console.log("position", position);

  let posPrivKey =
    marketMaker.positionPrivKeys[position.position_header.position_address];

  let initial_value_sum = 2000 * 10 ** COLLATERAL_TOKEN_DECIMALS;
  let vlp_amount_sum = initial_value_sum;

  // & header_hash = H({pos_hash, initial_value_sum, vlp_amount_sum})
  let messageHash = computeHashOnElements([
    position.hash,
    initial_value_sum,
    vlp_amount_sum,
  ]);

  let keyPair = getKeyPair(posPrivKey);
  let sig = sign(keyPair, "0x" + messageHash.toString(16));
  let marketId = 22;

  let closeMmMessage = {
    position,
    initial_value_sum,
    vlp_amount_sum,
    signature: { r: sig[0], s: sig[1] },
    market_id: marketId,
    synthetic_token: syntheticToken,
  };

  await client.close_onchain_mm(closeMmMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });
}

async function main() {
  // await initMM();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // await initPosition();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // await registerMM();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // await addLiquidity();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  // await removeLiquidity();

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  await closeMM();
}

main();
