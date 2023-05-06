const { sendDeposit } = require("./src/transactions/constructOrders");
const User = require("./src/users/Invisibl3User");
const { getActiveOrders } = require("./src/helpers/utils");

async function main() {
  let marketMaker = User.fromPrivKey(
    "0x01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1"
  );

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

  // await sendDeposit(marketMaker, 123, 5, 54321, 123456789);
  await sendDeposit(marketMaker, 234, 10000, 55555, 123456789);

  // console.log(marketMaker.getAvailableAmount(54321));
  console.log(marketMaker.getAvailableAmount(55555));
}

main();
