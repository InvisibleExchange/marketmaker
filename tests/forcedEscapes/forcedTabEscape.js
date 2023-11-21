const { makeDeposits, _loginUser, openOrderTab } = require("../../helpers");
const { restoreUserState } = require("../../src/helpers/keyRetrieval");
const { Note } = require("../../src/transactions/stateStructs/Notes");
const { sign, getKeyPair } = require("starknet").ec;

//

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const {
  OrderTab,
  TabHeader,
} = require("../../src/transactions/stateStructs/OrderTab");
const {
  COLLATERAL_TOKEN_DECIMALS,
  DUST_AMOUNT_PER_ASSET,
  DECIMALS_PER_ASSET,
  COLLATERAL_TOKEN,
} = require("../../src/helpers/utils");
const { sendPerpOrder } = require("../../src/transactions/constructOrders");
const {
  PositionHeader,
  PerpPosition,
} = require("../../src/transactions/stateStructs/PerpPosition");

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
  await makeDeposits([55555, 54321], [2_000, 1], config);
}

async function initOrderTab() {
  let config = {
    MM_CONFIG: { privKey: 12124823957273895723878239580315125238950951n },
  };

  let marketId = "12";

  await openOrderTab(marketId, config);
}

async function tryInvalidTabEscape() {
  let tabHeader = new TabHeader(
    0,
    54321,
    55555,
    672414187481264124n,
    12641751254124124n,
    0,
    0,
    1234n
  );
  let invalidTab = new OrderTab(1, tabHeader, 2, 2000, 0);

  let escapeMessage = {
    escape_id: 1,
    escape_notes: null,
    signature: { r: "0", s: "0" },
    close_order_tab_req: invalidTab.toGrpcObject(),
    close_position_message: null,
  };

  client.execute_escape(escapeMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });

  //
}

async function tryValidTabEscape() {
  let config = {
    MM_CONFIG: { privKey: 12124823957273895723878239580315125238950951n },
  };

  let marketMaker = await _loginUser(config);

  await restoreUserState(marketMaker, false, false, true);

  let orderTab = marketMaker.orderTabData[54321][0];

  let escapeMessage = {
    escape_id: 1,
    escape_notes: null,
    signature: { r: "0", s: "0" },
    close_order_tab_req: orderTab.toGrpcObject(),
    close_position_message: null,
  };

  client.execute_escape(escapeMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });

  //
}

async function main() {
  // await initMM();

  // await initOrderTab();

  // await tryInvalidTabEscape();

  await tryValidTabEscape();
}

main();
