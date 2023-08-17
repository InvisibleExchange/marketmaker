const { loadMMConfig } = require("../helpers");
const {
  getLiquidatablePositions,
} = require("../src/helpers/firebase/firebaseConnection");
const {
  SYMBOLS_TO_IDS,
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
} = require("../src/helpers/utils");
const {
  sendLiquidationOrder,
  sendPerpOrder,
} = require("../src/transactions/constructOrders");
const User = require("../src/users/Invisibl3User");
const { setupPriceFeeds } = require("../mmPriceFeeds");

const path = require("path");

const PRICE_FEEDS = {};

async function main() {
  let configPath = path.join(__dirname, "config.json");

  let MM_CONFIG = loadMMConfig(configPath).MM_CONFIG;

  let user = User.fromPrivKey(MM_CONFIG.privKey);
  await user.login();

  // Setup price feeds
  await setupPriceFeeds(MM_CONFIG, PRICE_FEEDS);

  // console.log("available_amount: ", user.positionData);
  console.log("available_amount: ", user.getAvailableAmount(55555));

  setInterval(async () => {
    for (let pair of Object.values(MM_CONFIG.pairs)) {
      // let midPrice = pair.invert
      //   ? 1 / PRICE_FEEDS[pair.priceFeedPrimary]
      //   : PRICE_FEEDS[pair.priceFeedPrimary];
      // if (!midPrice) continue;

      let token = SYMBOLS_TO_IDS[pair.symbol.split("-")[0]];

      let midPrice = 35600.5;

      let positions;
      try {
        positions = await getLiquidatablePositions(midPrice, token);
      } catch (_) {
        continue;
      }

      for (let position of positions) {
        let newPosition = await sendLiquidationOrder(
          user,
          position,
          midPrice,
          token,
          position.position_size / 10 ** DECIMALS_PER_ASSET[token],
          user.getAvailableAmount(COLLATERAL_TOKEN) /
            10 ** COLLATERAL_TOKEN_DECIMALS,
          0.1
        );

        console.log("newPosition: ", newPosition);

        let orderSide = newPosition.position_size == "Long" ? "Short" : "Long";
        await sendPerpOrder(
          user,
          orderSide,
          10,
          "Close",
          newPosition.position_header.position_address,
          newPosition.position_header.synthetic_token,
          newPosition.position_size / 10 ** DECIMALS_PER_ASSET[token],
          midPrice,
          null,
          0.07,
          0.1,
          true,
          {}
        ).then((res) => {
          console.log("available_amount: ", user.getAvailableAmount(55555));
        });
      }
    }
  }, 5000);
}

main();
