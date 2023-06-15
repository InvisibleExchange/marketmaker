const { makeDeposit } = require("../helpers");
const { loadMMConfig } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  await makeDeposit(55555, 200_000, config);
  await makeDeposit(12345, 8, config);
}

main();
