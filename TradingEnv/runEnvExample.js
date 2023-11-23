const { loadMMConfig, _loginUser } = require("../helpers");
const TradingEnvironment = require("./PerpMmEnvTemplate");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "config.json");
  let MM_CONFIG = loadMMConfig(configPath).MM_CONFIG;

  let privKey = "0x1234";
  let marketmaker = await _loginUser(privKey);

  let config = {
    SERVER_URL: "localhost",
    RELAY_WS_URL: `ws://localhost:4040`,
    CONFIG_CODE: 0,
    PERIODS: {
      REFRESH_PERIOD: 300_000,
      LIQUIDITY_INDICATION_PERIOD: 60_000,
      REFRESH_ORDERS_PERIOD: 60_000,
      FILL_ORDERS_PERIOD: 60_000,
      PRICE_UPDATE_PERIOD: 60_000,
    },
    MM_CONFIG,
    marketId: 12345,
  };

  let tradingEnv = new TradingEnvironment(marketmaker, config);

  await tradingEnv.runMarketmaker();
}

main();
