const runMarketmaker = require("../src/SpotMarketMaker");
const { loadMMConfig } = require("../src/helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);
  config.baseToken = "ETH";

  await runMarketmaker(config);
}

main();
