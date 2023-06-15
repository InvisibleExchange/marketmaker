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




// synthetic spent_amount: 7.197 533 361
// is_taker: true
// price: 1736.956

// collateral spent_amount: 12501 798 756
// is_taker: false
// qty: 7 197 533 361
// price: 1736.956


// ERROR: Some("overspending: \n12500.00 < 12501.79  or \n9506800000 < 7197533361")
// swap executed successfully in the backend engine







// synthetic spent_amount: 2309266639
// is_taker: true
// price: 1736.811
// collateral spent_amount: 4010759700
// is_taker: false
// qty: 2309266639
// price: 1736.811






