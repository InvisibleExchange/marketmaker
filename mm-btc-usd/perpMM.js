const runMarketmaker  = require("../PerpMarketMaker");
const { loadMMConfig } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "perp_config.json");

  let config = loadMMConfig(configPath);

  await runMarketmaker(config);
}

main();