const path = require("path");
const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const {
  executeNoteEscape,
  executeTabEscape,
} = require("../../src/onchainInteractions");
const { SYMBOLS_TO_IDS } = require("invisible-sdk/src/utils");

async function sendPositionEscapeTransaction() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let ethId = SYMBOLS_TO_IDS["ETH"];

  // let positionAddress =
  //   marketMaker.positionData[ethId][0].position_header.position_address;

  console.log(marketMaker.positionData);
  // console.log(positionAddress);

  // let receipt = await executeTabEscape(marketMaker, btcId, tabAddress);
}

sendPositionEscapeTransaction();
