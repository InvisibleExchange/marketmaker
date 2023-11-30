const { makeDeposits, loadMMConfig } = require("../src/helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "perp_config.json");

  let config = loadMMConfig(configPath).MM_CONFIG.privKey;

  await makeDeposits([55555], [100_000], config);
}

main();
