const { makeDeposits, loadMMConfig } = require("../src/helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath).MM_CONFIG.privKey;

  await makeDeposits([2413654107, 453755560], [100_000, 50], config);
}

main();
