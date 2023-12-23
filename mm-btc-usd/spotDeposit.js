const { loadMMConfig, makeDeposits } = require("../src/helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);
  let privKey = config.MM_CONFIG.privKey;

  await makeDeposits([2413654107, 3592681469], [150_000, 6], privKey);
}

main();
