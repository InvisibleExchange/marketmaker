const path = require("path");
const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const { executeNoteEscape } = require("../../src/onchainEscapes");

async function sendNoteEscapeTransaction() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "spot_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let receipt = await executeNoteEscape(marketMaker);

  console.log(receipt);
}

sendNoteEscapeTransaction();
