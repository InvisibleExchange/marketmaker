const { makeDeposit } = require("../helpers");
const { loadMMConfig } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "spot_config.json");

  let config = loadMMConfig(configPath);

  await makeDeposit(55555, 100_000, config);
  await makeDeposit(54321, 50, config);
}

main();






