const { makeDeposits, loadMMConfig } = require("../src/helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "perp_config.json");

  let config = loadMMConfig(configPath);
  let privKey = config.MM_CONFIG.privKey;

  await makeDeposits([55555], [150_000], privKey);
}

main();
