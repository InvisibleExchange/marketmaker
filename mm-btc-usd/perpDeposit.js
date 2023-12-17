const { makeDeposits } = require("../src/helpers");

const path = require("path");
const fs = require("fs");

async function main() {
  let configPath = path.join(__dirname, "perp_config.json");
  const mmConfigFile = fs.readFileSync(configPath, "utf8");
  let config = JSON.parse(mmConfigFile);

  let privKey = config.PRIVATE_KEY;
  await makeDeposits([55555], [100_000], privKey);
}

main();
