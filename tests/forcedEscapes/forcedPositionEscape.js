const { makeDeposits, _loginUser, openOrderTab } = require("../../helpers");
const { restoreUserState } = require("../../src/helpers/keyRetrieval");
const { Note } = require("../../src/transactions/stateStructs/Notes");
const { sign, getKeyPair } = require("starknet").ec;

//

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const {
  COLLATERAL_TOKEN_DECIMALS,
  DUST_AMOUNT_PER_ASSET,
  DECIMALS_PER_ASSET,
  COLLATERAL_TOKEN,
  PRICE_DECIMALS_PER_ASSET,
} = require("../../src/helpers/utils");
const { sendPerpOrder } = require("../../src/transactions/constructOrders");
const {
  PositionHeader,
  PerpPosition,
} = require("../../src/transactions/stateStructs/PerpPosition");
const {
  OpenOrderFields,
} = require("../../src/transactions/orderStructs/PerpOrder");

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
  let config = {
    MM_CONFIG: { privKey: 12124823957273895723878239580315125238950951n },
  };

  //
  await makeDeposits([55555], [2_000], config);
}

async function initCounterparty() {
  let config = {
    MM_CONFIG: { privKey: 72835623539285623958723942389532489273523025n },
  };

  //
  await makeDeposits([55555, 55555], [800, 1200], config);
}

async function initPosition() {
  let config = {
    MM_CONFIG: { privKey: 12124823957273895723878239580315125238950951n },
  };

  let marketMaker = await _loginUser(config);

  let syntheticAsset = 54321;

  let margin = marketMaker.getAvailableAmount(COLLATERAL_TOKEN);

  if (margin < 100000) return;

  margin = margin / 10 ** COLLATERAL_TOKEN_DECIMALS;

  await sendPerpOrder(
    marketMaker,
    "Long",
    1000,
    "Open",
    null,
    syntheticAsset,
    0.1,
    2050,
    margin,
    0.07,
    5,
    true,
    null
  );
}

async function tryInvalidPositionEscape() {
  let config = {
    MM_CONFIG: { privKey: 12124823957273895723878239580315125238950951n },
  };
  let marketMaker = await _loginUser(config);

  config = {
    MM_CONFIG: { privKey: 72835623539285623958723942389532489273523025n },
  };
  let counterParty = await _loginUser(config);

  // !: Things to check:
  //
  // todo: verify signature
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

  let forcePositionCloseMessage = {
    position_a: validPosition,
    close_price: 2050 * 10 ** PRICE_DECIMALS_PER_ASSET[54321],
    open_order_fields_b: validOpenOrderFields.toGrpcObject(),
    position_b: null,
    signature_a: { r: "0", s: "0" },
    signature_b: { r: "0", s: "0" },
  };

  let escapeMessage = {
    escape_id: 1,
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

async function tryValidPositionEscape() {
  let config = {
    MM_CONFIG: { privKey: 12124823957273895723878239580315125238950951n },
  };

  let marketMaker = await _loginUser(config);

  // await restoreUserState(marketMaker, false, false, true);

  let position = marketMaker.positionData[54321][0];

  console.log("position", position);

  //
}

//

async function main() {
  //   await initMM();
  //
  // await initPosition();
  //
  //   await initCounterparty();
  //
  await tryInvalidPositionEscape();
  //
  //    await tryValidPositionEscape();
}

main();
