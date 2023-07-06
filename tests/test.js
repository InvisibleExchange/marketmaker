const {
  sendDeposit,
  sendSpotOrder,
  sendSplitOrder,
} = require("../src/transactions/constructOrders");
const User = require("../src/users/Invisibl3User");
const {
  getActiveOrders,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
} = require("../src/helpers/utils");

const fs = require("fs");
const { default: axios } = require("axios");

async function sendLimitOrders() {
  // Get random number between 0 and 1
  let random = "0x" + Math.floor(Math.random() * 1000000000000000).toString(16);

  let marketMaker = User.fromPrivKey(random);

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

  let ethAmount = 1;
  let usdcAmount = 1000;
  let price = usdcAmount / ethAmount;

  for (let i = 0; i < 10; i++) {
    await sendDeposit(marketMaker, 123, ethAmount, 54321, 123456789);
    await sendDeposit(marketMaker, 234, usdcAmount, 55555, 123456789);
  }

  // ? Send buy orders ==============================================
  for (let i = 0; i < 10; i++) {
    // await sendSplitOrder(marketMaker, 55555, amount);

    await sendSpotOrder(
      marketMaker,
      "Buy",
      1000,
      54321,
      55555,
      ethAmount,
      usdcAmount,
      price,
      0.1,
      null,
      false,
      {}
    ).then(() => {});
  }

  // ? Send sell orders =============================================
  for (let i = 0; i < 10; i++) {
    // await sendSplitOrder(marketMaker, 54321, amount);

    await sendSpotOrder(
      marketMaker,
      "Sell",
      1000,
      54321,
      55555,
      ethAmount,
      usdcAmount,
      price,
      0.1,
      null,
      false,
      {}
    ).then(() => {});
  }
}

const { getKeyPair, sign } = require("starknet").ec;
async function main() {
  // await deposit();

  // await sendLimitOrders();

  await finalize_batch();
}

async function finalize_batch() {
  await axios.post(`http://localhost:4000/finalize_batch`, {});
}

main();

// const User = require("./Invisibl3User");

// const bigint = require("big-integer");

// let privKey_ =
//   "1d5b3e6b261372758fabd6dc509f1eabfc719d310d0b9e849bccca97a5c5983";

// let user = User.fromPrivKey(privKey_);

// let address = user.getPositionAddress(12345);
// console.log(address.positionPrivKey);
// console.log(address.positionAddress.getX().toString());

// let encryptedPk = bigint(address.positionPrivKey)
//   .xor(user.privateSeed)
//   .toString();

// console.log(encryptedPk);
