const runMarketmaker = require("../src/PerpMarketMaker");
const { loadMMConfig } = require("../src/helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "perp_config.json");

  let config = loadMMConfig(configPath);
  config.baseToken = "PEPE";

  await runMarketmaker(config);
}

main();
