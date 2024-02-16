const { loadMMConfig } = require("../src/helpers");
const { getLiquidatablePositions } = require("invisible-sdk/src/utils");
const {
  SYMBOLS_TO_IDS,
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
} = require("invisible-sdk/src/utils");
const {
  sendLiquidationOrder,
  sendPerpOrder,
} = require("invisible-sdk/src/transactions");
const { priceUpdate } = require("../src/mmPriceFeeds");

const path = require("path");
const { UserState } = require("invisible-sdk/src/users");

const PRICE_FEEDS = {};

async function main() {
  let configPath = path.join(__dirname, "config.json");

  let MM_CONFIG = loadMMConfig(configPath).MM_CONFIG;

  let user = UserState.fromPrivKey(MM_CONFIG.privKey);
  await user.login();

  // Setup price feeds
  try {
    await priceUpdate(PRICE_FEEDS, MM_CONFIG);
    setInterval(async () => {
      await priceUpdate(PRICE_FEEDS, MM_CONFIG);
    }, 10_000);
  } catch (error) {
    console.log("Error setting up price feeds: ", error);
  }

  setInterval(async () => {
    for (let pair of Object.values(MM_CONFIG.pairs)) {
      let token = SYMBOLS_TO_IDS[pair.symbol.split("-")[0]];

      let midPrice = PRICE_FEEDS[pair.symbol]?.price;
      if (!midPrice) continue;

      console.log("midPrice: ", midPrice);
      console.log(user.getAvailableAmount(COLLATERAL_TOKEN));

      let positions;
      try {
        positions = await getLiquidatablePositions(midPrice, token);
      } catch (_) {
        continue;
      }

      for (let position of positions) {
        console.log("position: ", position);

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

        console.log("\nnewPosition: ", newPosition);

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
          1.5,
          true,
          {}
        ).then((_) => {
          console.log("pos Data: ", user.positionData);
          console.log(
            "available_amount: ",
            user.getAvailableAmount(COLLATERAL_TOKEN)
          );
        });
      }
    }
  }, 5000);
}

main();
