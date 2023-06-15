const { getActiveOrders } = require("./src/helpers/utils");

const fs = require("fs");
const User = require("./src/users/Invisibl3User");
const { sendDeposit } = require("./src/transactions/constructOrders");

async function makeDeposit(token, amount, config) {
  let MM_CONFIG = config.MM_CONFIG;

  let marketMaker = User.fromPrivKey(MM_CONFIG.privKey);

  let { emptyPrivKeys, emptyPositionPrivKeys } = await marketMaker.login();

  let { badOrderIds, orders, badPerpOrderIds, perpOrders, pfrNotes } =
    await getActiveOrders(marketMaker.orderIds, marketMaker.perpetualOrderIds);

  await marketMaker.handleActiveOrders(
    badOrderIds,
    orders,
    badPerpOrderIds,
    perpOrders,
    pfrNotes,
    emptyPrivKeys,
    emptyPositionPrivKeys
  );

  await sendDeposit(marketMaker, 123, amount, token, 123456789);

  console.log(marketMaker.getAvailableAmount(token));
}

const loadMMConfig = (configPath) => {
  // Load MM config
  let MM_CONFIG;
  if (process.env.MM_CONFIG) {
    MM_CONFIG = JSON.parse(process.env.MM_CONFIG);
  } else {
    const mmConfigFile = fs.readFileSync(configPath, "utf8");
    MM_CONFIG = JSON.parse(mmConfigFile);
  }

  let activeMarkets = [];
  for (let marketId of Object.keys(MM_CONFIG.pairs)) {
    if (MM_CONFIG.pairs[marketId].active) {
      activeMarkets.push(marketId);
    }
  }

  return { MM_CONFIG, activeMarkets };
};

module.exports = {
  loadMMConfig,
  makeDeposit,
};
