const { makeDeposit } = require("../helpers");
const { loadMMConfig } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "perp_config.json");

  let config = loadMMConfig(configPath);

  await makeDeposit(55555, 150_000, config);
}

main();
