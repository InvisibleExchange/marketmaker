const { makeDeposits, loadMMConfig } = require("../helpers");

const path = require("path");

async function main() {
  let configPath = path.join(__dirname, "config.json");

  let config = loadMMConfig(configPath);

  await makeDeposits([55555], [100_000], config);
}

main();
