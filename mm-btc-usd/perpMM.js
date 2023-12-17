
const { UserState } = require("invisible-sdk/src/users");
const TradingEnvironment = require("../TradingEnv/PerpMmEnvTemplate");

const path = require("path");
const fs = require("fs");

async function main() {
  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  let marketmaker = await UserState.loginUser(privKey);

  let tradingEnv = new TradingEnvironment(marketmaker, config);

  await tradingEnv.runMarketmaker();
}

main();
