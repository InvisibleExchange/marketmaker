const { loadMMConfig, makeDeposits } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  await makeDeposits([55555, 12345], [150_000, 6], config);
}

main();
