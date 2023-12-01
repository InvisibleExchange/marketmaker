const { makeDeposits } = require("../../src/helpers");

const { sign, getKeyPair } = require("starknet").ec;

//

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const {
  COLLATERAL_TOKEN_DECIMALS,
  COLLATERAL_TOKEN,
  PRICE_DECIMALS_PER_ASSET,
  computeHashOnElements,
} = require("invisible-sdk/src/helpers/utils");
const {
  Note,
  PositionHeader,
  PerpPosition,
  OpenOrderFields,
  sendPerpOrder,
} = require("invisible-sdk/src/transactions");
const { UserState } = require("invisible-sdk/src/users");

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

async function initMM() {
  let privKey = 1212482395727389572387823958031512523895023551n;

  //
  await makeDeposits([55555], [2_000], privKey);
}

async function initCounterparty() {
  let privKey = 72835623577775623958723942389532489273523025n;

  //
  await makeDeposits([55555, 55555], [800, 1200], privKey);
}

async function initPosition() {
  let privKey = 1212482395727389572387823958031512523895023551n;

  let marketMaker = await UserState.loginUser(privKey);

  let syntheticAsset = 54321;

  let margin = marketMaker.getAvailableAmount(COLLATERAL_TOKEN);

  console.log("margin", margin);
  if (margin < 10_000_000) return;

  margin = margin / 10 ** COLLATERAL_TOKEN_DECIMALS;

  await sendPerpOrder(
    marketMaker,
    "Long",
    1000,
    "Open",
    null,
    syntheticAsset,
    0.1,
    2104.05,
    margin,
    0.07,
    5,
    true,
    null
  );
}

async function initPosition_b() {
  let privKey = 72835623577775623958723942389532489273523025n;

  let counterParty = await UserState.loginUser(privKey);

  let syntheticAsset = 54321;

  let margin = counterParty.getAvailableAmount(COLLATERAL_TOKEN);

  if (margin < 100) return;

  margin = margin / 10 ** COLLATERAL_TOKEN_DECIMALS;

  await sendPerpOrder(
    counterParty,
    "Short",
    1000,
    "Open",
    null,
    syntheticAsset,
    0.1,
    2104.05,
    margin,
    0.07,
    5,
    true,
    null
  );
}

async function tryPositionEscape1() {
  let privKey = 1212482395727389572387823958031512523895023551n;
  let marketMaker = await UserState.loginUser(privKey);

  privKey = 72835623577775623958723942389532489273523025n;
  let counterParty = await UserState.loginUser(privKey);

  //
  // ! - Does position_a exist?
  let validPosition = marketMaker.positionData[54321][0];
  if (typeof validPosition.order_side === "string") {
    validPosition.order_side = validPosition.order_side === "Long" ? 1 : 0;
  }

  let positionHeader = new PositionHeader(
    54321,
    695382532562398523568993285235n,
    true,
    0,
    0
  );
  let invalidPosition = new PerpPosition(
    validPosition.index,
    positionHeader,
    validPosition.order_side,
    validPosition.position_size,
    validPosition.margin,
    validPosition.entry_price,
    validPosition.liquidation_price,
    validPosition.bankruptcy_price,
    validPosition.last_funding_idx,
    validPosition.vlp_supply
  );
  //
  // ! - Do notes_in_b exist?
  let notesInB = counterParty.noteData[55555];
  let noteSum = notesInB.reduce((acc, note) => {
    return acc + note.amount;
  }, 0);

  let addr = getKeyPair(1234n);
  let invalidNote2 = new Note(
    addr.getPublic(),
    55555,
    notesInB[1].amount,
    notesInB[1].blinding,
    notesInB[1].index
  );

  let validOpenOrderFields = new OpenOrderFields(
    noteSum,
    55555,
    notesInB,
    null,
    validPosition.position_header.position_address,
    1
  );
  let invalidOpenOrderFields = new OpenOrderFields(
    2000 * 10 ** COLLATERAL_TOKEN_DECIMALS,
    55555,
    [notesInB[0], invalidNote2],
    null,
    validPosition.position_header.position_address,
    1
  );
  //
  // ! - is liquidatable?
  //
  // ! - verify notes_in sum == initital margin is valid
  let refundNote2 = invalidNote2;
  let invalidOpenOrderFields2 = new OpenOrderFields(
    2000 * 10 ** COLLATERAL_TOKEN_DECIMALS,
    55555,
    notesInB,
    refundNote2,
    validPosition.position_header.position_address,
    1
  );
  //
  // ! - return leverage_b is < 15
  let refundNote3 = new Note(
    addr.getPublic(),
    55555,
    noteSum - 10 * 10 ** COLLATERAL_TOKEN_DECIMALS,
    notesInB[0].blinding,
    notesInB[0].index
  );

  let invalidOpenOrderFields3 = new OpenOrderFields(
    10 * 10 ** COLLATERAL_TOKEN_DECIMALS,
    55555,
    notesInB,
    refundNote3,
    validPosition.position_header.position_address,
    1
  );
  //

  // * ===============================================
  let escape_id = 1;

  // & H = pedersen(escape_id, position_a.hash, close_price, (open_order_fields_b.hash or position_b.hash) )

  let escapeHash = computeHashOnElements([
    escape_id,
    validPosition.hash,
    2050 * 10 ** PRICE_DECIMALS_PER_ASSET[54321],
    validOpenOrderFields.hash(),
  ]);

  let keyPair_a = getKeyPair(
    marketMaker.positionPrivKeys[
      validPosition.position_header.position_address
    ].toString()
  );
  let sig_a = sign(keyPair_a, "0x" + escapeHash.toString(16));

  let privKeySum = 0n;
  for (const note of notesInB) {
    privKeySum += counterParty.notePrivKeys[note.address.getX().toString()];
  }
  let keyPair_b = getKeyPair(privKeySum);
  let sig_b = sign(keyPair_b, "0x" + escapeHash.toString(16));

  // * -----------------------------------------------

  let forcePositionCloseMessage = {
    position_a: validPosition,
    close_price: 2050 * 10 ** PRICE_DECIMALS_PER_ASSET[54321],
    // open_order_fields_b: validOpenOrderFields.toGrpcObject(),
    open_order_fields_b: invalidOpenOrderFields.toGrpcObject(),
    position_b: null,
    signature_a: { r: sig_a[0], s: sig_a[1] },
    signature_b: { r: sig_b[0], s: sig_b[1] },
  };

  let escapeMessage = {
    escape_id,
    escape_notes: null,
    signature: null,
    close_order_tab_req: null,
    close_position_message: forcePositionCloseMessage,
  };

  console.log("escapeMessage", escapeMessage);

  client.execute_escape(escapeMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });
}

// --------------------------------------------------------------------------------------

async function tryPositionEscape2() {
  let privKey = 1212482395727389572387823958031512523895023551n;
  let marketMaker = await UserState.loginUser(privKey);

  let privKey2 = 72835623577775623958723942389532489273523025n;
  let counterParty = await UserState.loginUser(privKey2);

  // ! - Does position_a exist?
  let validPosition = marketMaker.positionData[54321][0];
  if (typeof validPosition.order_side === "string") {
    validPosition.order_side = validPosition.order_side === "Long" ? 1 : 0;
  }

  // * -----------------------------------------------

  let positionB = counterParty.positionData[54321][0];
  if (typeof positionB.order_side === "string") {
    positionB.order_side = positionB.order_side === "Long" ? 1 : 0;
  }

  // ! -  Does position_b exist?
  // positionB.position_header.position_address = 12976235982365238562395n;

  // ! - Position is not liquidatable
  // ! - Synthetic token is invalid
  // positionB.position_header.synthetic_token = 12345;
  // ! - leverage is invalid after update

  //

  // * ===============================================
  let escape_id = 2;

  // & H = pedersen(escape_id, position_a.hash, close_price, (open_order_fields_b.hash or position_b.hash) )

  let escapeHash = computeHashOnElements([
    escape_id,
    validPosition.hash,
    2050 * 10 ** PRICE_DECIMALS_PER_ASSET[54321],
    positionB.hash,
  ]);

  let keyPair_a = getKeyPair(
    marketMaker.positionPrivKeys[
      validPosition.position_header.position_address
    ].toString()
  );
  let sig_a = sign(keyPair_a, "0x" + escapeHash.toString(16));

  let keyPair_b = getKeyPair(
    counterParty.positionPrivKeys[
      positionB.position_header.position_address
    ].toString()
  );
  let sig_b = sign(keyPair_b, "0x" + escapeHash.toString(16));

  // * -----------------------------------------------

  let forcePositionCloseMessage = {
    position_a: validPosition,
    close_price: 2050 * 10 ** PRICE_DECIMALS_PER_ASSET[54321],
    open_order_fields_b: null,
    position_b: positionB,
    signature_a: { r: sig_a[0], s: sig_a[1] },
    signature_b: { r: sig_b[0], s: sig_b[1] },
  };

  let escapeMessage = {
    escape_id,
    escape_notes: null,
    signature: null,
    close_order_tab_req: null,
    close_position_message: forcePositionCloseMessage,
  };

  console.log("escapeMessage", escapeMessage);

  client.execute_escape(escapeMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });
}

async function main() {
  // await initMM();
  //
  // await initPosition();
  //
  // await initCounterparty();
  //
  // await initPosition_b();
  //
  await tryPositionEscape1();
  //
  // await tryPositionEscape2();
  //
}

main();
