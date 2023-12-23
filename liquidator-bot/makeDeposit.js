const { makeDeposits, loadMMConfig } = require("../src/helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "config.json");

  let config = loadMMConfig(configPath);
  let privKey = config.MM_CONFIG.privKey;

  await makeDeposits([2413654107], [100_000], privKey);
}

main();
