const { makeDeposits, openOrderTab } = require("../../src/helpers");
const { restoreUserState } = require("invisible-sdk/src/utils");

//

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { OrderTab, TabHeader } = require("invisible-sdk/src/transactions");
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
  let privKey = 1212482395727389572111221320315125238950951n;

  //
  await makeDeposits([55555, 54321], [2_000, 1], privKey);
}

async function initOrderTab() {
  let privKey = 1212482395727389572111221320315125238950951n;

  let marketId = "12";

  await openOrderTab(marketId, privKey);
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

  await client.execute_escape(escapeMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });

  //
}

async function tryValidTabEscape() {
  let privKey = 1212482395727389572111221320315125238950951n;

  let marketMaker = await UserState.loginUser(privKey);

  // await restoreUserState(marketMaker, false, false, true);

  let orderTab = marketMaker.orderTabData[54321][0];

  let escapeMessage = {
    escape_id: 1,
    escape_notes: null,
    signature: { r: "0", s: "0" },
    close_order_tab_req: orderTab.toGrpcObject(),
    close_position_message: null,
  };

  await client.execute_escape(escapeMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });

  //
}

async function main() {
  await initMM();
  console.log("initMM done");

  // await initOrderTab();
  // console.log("initOrderTab done");

  // await tryInvalidTabEscape();
  // console.log("tryInvalidTabEscape done");

  // await tryValidTabEscape();
  // console.log("tryValidTabEscape done");
}

main();
