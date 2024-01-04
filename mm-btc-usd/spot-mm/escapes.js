const path = require("path");
const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const {
  executeNoteEscape,
  executeTabEscape,
} = require("../../src/onchainEscapes");
const { SYMBOLS_TO_IDS } = require("invisible-sdk/src/utils");

async function sendTabEscapeTransaction() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "spot_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let btcId = SYMBOLS_TO_IDS["BTC"];

  let tabAddress = marketMaker.orderTabData[btcId][0].tab_header.pub_key;

  let receipt = await executeTabEscape(marketMaker, btcId, tabAddress);

  console.log(receipt);
}

sendTabEscapeTransaction();
