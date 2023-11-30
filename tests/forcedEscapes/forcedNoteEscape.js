const { makeDeposits, _loginUser, openOrderTab } = require("../../helpers");
const { restoreUserState } = require("../../src/helpers/keyRetrieval");
const { Note } = require("../../src/transactions/stateStructs/Notes");
const { sign, getKeyPair } = require("starknet").ec;

//

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

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
  let privKey = 12124823957273895723878239580315125238950951n;

  //
  await makeDeposits([55555, 54321], [2_000, 1], privKey);
}

async function tryInvalidNoteEscape() {
  let privKey = 12124823957273895723878239580315125238950951n;

  let marketMaker = await _loginUser(privKey);

  // await restoreUserState(marketMaker, true, false);

  let ethNote = marketMaker.noteData[54321][0];
  let usdcNote = marketMaker.noteData[55555][0];

  let addr = getKeyPair(1234n);
  let invalidBtcNote = new Note(
    addr.getPublic(),
    12345,
    1 * 10 ** 8,
    5698341534576289437634823653454366346436634436346n,
    1
  );

  let escapeMessage = {
    escape_id: 1,
    escape_notes: [
      ethNote.toGrpcObject(),
      usdcNote.toGrpcObject(),
      invalidBtcNote.toGrpcObject(),
    ],
    signature: { r: "0", s: "0" },
    close_order_tab_req: null,
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

async function tryValidNoteEscape() {
  let privKey = 12124823957273895723878239580315125238950951n;

  let marketMaker = await _loginUser(privKey);

  // await restoreUserState(marketMaker, true, false);

  let ethNote = marketMaker.noteData[54321][0];
  let usdcNote = marketMaker.noteData[55555][0];

  let escapeMessage = {
    escape_id: 1,
    escape_notes: [ethNote.toGrpcObject(), usdcNote.toGrpcObject()],
    signature: { r: "0", s: "0" },
    close_order_tab_req: null,
    close_position_message: null,
  };

  console.log("escapeMessage", escapeMessage);

  client.execute_escape(escapeMessage, function (err, response) {
    if (err) {
      console.log(err);
    } else {
      console.log("response", response);
    }
  });

  //
}

//

async function main() {
  // await initMM();

  // await tryInvalidNoteEscape();

  await tryValidNoteEscape();
}

main();
