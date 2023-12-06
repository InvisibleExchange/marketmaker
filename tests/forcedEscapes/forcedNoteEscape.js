const { makeDeposits } = require("../../src/helpers");
const { Note } = require("invisible-sdk/src/transactions");

const { sign, getKeyPair } = require("starknet").ec;

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

async function initMM() {
  let privKey = 12124823957273895723878239580315125238950951n;

  //
  await makeDeposits([55555, 54321], [2_000, 1], privKey);
}

async function tryInvalidNoteEscape() {
  let privKey = 12124823957273895723878239580315125238950951n;

  let marketMaker = await UserState.loginUser(privKey);

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

  await client.execute_escape(escapeMessage, function (err, response) {
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

  let marketMaker = await UserState.loginUser(privKey);

  // await restoreUserState(marketMaker, true, false);

  let escape_id = 2;
  let ethNote = marketMaker.noteData[54321][0];
  let usdcNote = marketMaker.noteData[55555][0];

  let hashInputs = [escape_id, ethNote.hash, usdcNote.hash];
  let escapeHash = computeHashOnElements(hashInputs);

  let keyPairSum = getKeyPair(
    marketMaker.notePrivKeys[ethNote.address.getX().toString()] +
      marketMaker.notePrivKeys[usdcNote.address.getX().toString()]
  );
  let sig = sign(keyPairSum, "0x" + escapeHash.toString(16));

  let escapeMessage = {
    escape_id,
    escape_notes: [ethNote.toGrpcObject(), usdcNote.toGrpcObject()],
    signature: { r: sig[0], s: sig[1] },
    close_order_tab_req: null,
    close_position_message: null,
  };

  console.log("escapeMessage", escapeMessage);

  await client.execute_escape(escapeMessage, function (err, response) {
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
  await initMM();
  console.log("initMM done\n\n");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await tryInvalidNoteEscape();
  console.log("tryInvalidNoteEscape done\n\n");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  await tryValidNoteEscape();
  console.log("tryValidNoteEscape done\n\n");
}

main();
