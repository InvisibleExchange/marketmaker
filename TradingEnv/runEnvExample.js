const { UserState } = require("invisible-sdk/src/users");
const TradingEnvironment = require("./PerpMmEnvTemplate");

const path = require("path");
const fs = require("fs");

const { makeDeposits } = require("../src/helpers");

async function main() {
  let configPath = path.join(__dirname, "config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(mmConfigFile);

  let privKey = "0x01012000";
  let marketmaker = await UserState.loginUser(privKey);

  if (
    !marketmaker.positionData[12345]?.length > 0 &&
    marketmaker.getAvailableAmount(55555) < 100_000_000
  ) {
    await makeDeposits([55555], [100_000], privKey);
  }

  let tradingEnv = new TradingEnvironment(marketmaker, config);

  await tradingEnv.runMarketmaker();
}

main();
