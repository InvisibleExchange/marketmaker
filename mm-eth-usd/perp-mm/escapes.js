const path = require("path");
const fs = require("fs");
const { UserState } = require("invisible-sdk/src/users");
const { executePositionEscape } = require("../../src/onchainEscapes");
const { SYMBOLS_TO_IDS } = require("invisible-sdk/src/utils");

async function sendPositionEscapeTransaction() {
  // * Onchain deposits

  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketMaker = await UserState.loginUser(privKey);

  let ethId = SYMBOLS_TO_IDS["ETH"];

  let positionAddress =
    marketMaker.positionData[ethId][0].position_header.position_address;

  // console.log(marketMaker.positionData[ethId][0]);

  let closePrice = 2300;
  let recipient = "0x2b2eA7eC7e366666772DaAf496817c14b8c0Ae74";

  let initialMargin = 500;

  let receipt = await executePositionEscape(
    marketMaker,
    ethId,
    closePrice,
    recipient,
    positionAddress,
    null,
    initialMargin
  );

  console.log(receipt);
}

sendPositionEscapeTransaction();
