const runMarketmaker = require("../SpotMarketMaker");
const { loadMMConfig } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  await runMarketmaker(config);
}

main();
