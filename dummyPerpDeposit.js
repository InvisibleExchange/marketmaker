const { sendDeposit } = require("./src/transactions/constructOrders");
const User = require("./src/users/Invisibl3User");
const { getActiveOrders } = require("./src/helpers/utils");

async function main() {
  let MM_CONFIG;
  if (process.env.MM_CONFIG) {
    MM_CONFIG = JSON.parse(process.env.MM_CONFIG);
  } else {
    const mmConfigFile = fs.readFileSync("perp_config.json", "utf8");
    MM_CONFIG = JSON.parse(mmConfigFile);
  }

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

  await sendDeposit(marketMaker, 234, 10000, 55555, 123456789);

  console.log(marketMaker.getAvailableAmount(55555));
}

main();
