const {
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  DUST_AMOUNT_PER_ASSET,
  PERP_MARKET_IDS_2_TOKENS,
} = require("invisible-sdk/src/utils");
const { getPrice, isOrderFillable } = require("./helpers");
const {
  sendPerpOrder,
  sendAmendOrder,
} = require("invisible-sdk/src/transactions");

function getSizeFromLeverage(indexPrice, leverage, margin) {
  if (indexPrice == 0) {
    return 0;
  }

  const size = (Number(margin) * Number(leverage)) / Number(indexPrice);

  return size;
}

async function fillOpenOrders(
  marketId,
  perpLiquidity,
  marketmaker,
  MM_CONFIG,
  PRICE_FEEDS,
  ACTIVE_ORDERS,
  errorCounter
) {
  let syntheticToken = PERP_MARKET_IDS_2_TOKENS[marketId];

  if (!perpLiquidity[syntheticToken]) return;

  if (perpLiquidity[syntheticToken].bidQueue) {
    for (let order of perpLiquidity[syntheticToken].bidQueue) {
      let fillable = isOrderFillable(
        order,
        "b",
        syntheticToken,
        MM_CONFIG,
        PRICE_FEEDS
      );

      if (fillable.fillable) {
        sendFillRequest(
          order,
          "b",
          marketId,
          marketmaker,
          MM_CONFIG,
          PRICE_FEEDS,
          ACTIVE_ORDERS,
          errorCounter
        );
      } else if (fillable.reason.toString() == "badprice") {
        break;
      }
    }
  }

  if (perpLiquidity[syntheticToken].askQueue) {
    for (let order of perpLiquidity[syntheticToken].askQueue.reverse()) {
      let fillable = isOrderFillable(
        order,
        "s",
        syntheticToken,
        MM_CONFIG,
        PRICE_FEEDS
      );

      if (fillable.fillable) {
        sendFillRequest(
          order,
          "s",
          marketId,
          marketmaker,
          MM_CONFIG,
          PRICE_FEEDS,
          ACTIVE_ORDERS,
          errorCounter
        );
      } else if (fillable.reason.toString() == "badprice") {
        break;
      }
    }
  }
}

// order: {price, amount, timestamp}
async function sendFillRequest(
  otherOrder,
  otherSide,
  marketId,
  marketmaker,
  MM_CONFIG,
  PRICE_FEEDS,
  ACTIVE_ORDERS,
  errorCounter
) {
  const mmConfig = MM_CONFIG.config;
  if (!mmConfig?.active) return;

  let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

  const midPrice = PRICE_FEEDS[mmConfig.symbol]?.price;
  if (!midPrice) return;

  const baseQuantity =
    otherOrder.amount / 10 ** DECIMALS_PER_ASSET[syntheticAsset];

  let position = marketmaker.positionData[syntheticAsset][0];

  const margin = position.margin;

  const maxSynthetic = getSizeFromLeverage(
    midPrice,
    margin / 10 ** COLLATERAL_TOKEN_DECIMALS,
    mmConfig.maxLeverage
  );

  let addableValue;
  if (otherSide === "s") {
    // we send a buy order
    const positionLongSize =
      position.order_side == "Long"
        ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
        : 0;
    const activeBuyOrderValue = ACTIVE_ORDERS[marketId + "Buy"]
      ? ACTIVE_ORDERS[marketId + "Buy"].reduce(
          (acc, order) => acc + order.syntheticAmount,
          0
        )
      : 0;

    addableValue = maxSynthetic - activeBuyOrderValue - positionLongSize;
  } else {
    // we send a sell order
    const positionShortSize =
      position.order_side == "Short"
        ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
        : 0;
    // sum up all the active orders
    const activeSellOrderValue = ACTIVE_ORDERS[marketId + "Sell"]
      ? ACTIVE_ORDERS[marketId + "Sell"].reduce(
          (acc, order) => acc + order.syntheticAmount,
          0
        )
      : 0;

    addableValue = maxSynthetic - activeSellOrderValue - positionShortSize;
  }

  let unfilledAmount = baseQuantity;
  let unfilledUsdAmount =
    unfilledAmount * getPrice(syntheticAsset, MM_CONFIG, PRICE_FEEDS);

  if (
    addableValue * getPrice(syntheticAsset, MM_CONFIG, PRICE_FEEDS) >= 10 &&
    unfilledUsdAmount >= 10
  ) {
    sendPerpOrder(
      marketmaker,
      otherSide == "s" ? "Long" : "Short",
      MM_CONFIG.EXPIRATION_TIME,
      "Modify",
      position.position_header.position_address,
      syntheticAsset,
      addableValue,
      otherOrder.price,
      null,
      0.07,
      0.01,
      true,
      ACTIVE_ORDERS
    ).catch((err) => {
      // console.log("Error sending perp order: ", err);
      errorCounter++;
    });

    unfilledAmount -= addableValue;
  }

  if (ACTIVE_ORDERS[otherSide === "s" ? marketId + "Buy" : marketId + "Sell"]) {
    let sortedOrders = ACTIVE_ORDERS[
      otherSide === "s" ? marketId + "Buy" : marketId + "Sell"
    ].sort((a, b) => {
      return otherSide === "b" ? a.price - b.price : b.price - a.price;
    });

    for (let order of sortedOrders) {
      if (
        unfilledAmount <
        DUST_AMOUNT_PER_ASSET[syntheticAsset] /
          10 ** DECIMALS_PER_ASSET[syntheticAsset]
      )
        return;

      // Send amend order
      sendAmendOrder(
        marketmaker,
        order.id,
        otherSide === "s" ? "Buy" : "Sell",
        true, // isPerp,
        marketId,
        otherSide === "s"
          ? otherOrder.price * (1 + 0.0001)
          : otherOrder.price * (1 - 0.0001),
        MM_CONFIG.EXPIRATION_TIME,
        null,
        true, // match_only
        ACTIVE_ORDERS
      ).catch((err) => {
        // console.log("Error amending order: ", err);
        errorCounter++;
      });

      unfilledAmount -=
        order.syntheticAmount / 10 ** DECIMALS_PER_ASSET[syntheticAsset];
    }
  }
}

async function indicateLiquidity(
  marketId,
  marketmaker,
  MM_CONFIG,
  PRICE_FEEDS,
  ACTIVE_ORDERS,
  errorCounter
) {
  const mmConfig = MM_CONFIG.config;
  if (!mmConfig?.active) return;

  let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

  const midPrice = PRICE_FEEDS[mmConfig.symbol]?.price;
  if (!midPrice) return;

  if (!marketmaker.positionData[syntheticAsset]) return;

  const side = mmConfig.side || "d";

  let position = marketmaker.positionData[syntheticAsset][0];

  const margin = position.margin;

  const maxSynthetic = getSizeFromLeverage(
    midPrice,
    margin / 10 ** COLLATERAL_TOKEN_DECIMALS,
    mmConfig.maxLeverage
  );

  // sum up all the active orders
  const activeSellOrderValue = ACTIVE_ORDERS[marketId + "Sell"]
    ? ACTIVE_ORDERS[marketId + "Sell"].reduce(
        (acc, order) => acc + order.syntheticAmount,
        0
      )
    : 0;
  const activeBuyOrderValue = ACTIVE_ORDERS[marketId + "Buy"]
    ? ACTIVE_ORDERS[marketId + "Buy"].reduce(
        (acc, order) => acc + order.syntheticAmount,
        0
      )
    : 0;

  const positionLongSize =
    position.order_side == "Long"
      ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
      : 0;
  const positionShortSize =
    position.order_side == "Short"
      ? position.position_size / 10 ** DECIMALS_PER_ASSET[syntheticAsset]
      : 0;

  const addableBuyValue = maxSynthetic - activeBuyOrderValue - positionLongSize;
  const addableSellValue =
    maxSynthetic - activeSellOrderValue - positionShortSize;

  const maxSize = Math.min(maxSynthetic, mmConfig.maxSize);

  // dont do splits if under 1000 USD
  const usdMaxValue =
    maxSynthetic * getPrice(syntheticAsset, MM_CONFIG, PRICE_FEEDS);
  let numSplits =
    usdMaxValue && usdMaxValue < 1000 ? 1 : mmConfig.numOrdersIndicated || 4;

  if (usdMaxValue && usdMaxValue < 10) {
    numSplits = 0;
  }

  if (["b", "d"].includes(side) && maxSize > 0) {
    // make a clone of the  ACTIVE_ORDERS[marketId + "Buy"] array
    // because we will be removing orders from it
    let activeOrdersCopy = [];
    if (ACTIVE_ORDERS[marketId + "Buy"]) {
      activeOrdersCopy = [...ACTIVE_ORDERS[marketId + "Buy"]];
    }
    for (let i = 0; i < activeOrdersCopy.length; i++) {
      const buyPrice =
        midPrice *
        (1 - mmConfig.minSpread - (mmConfig.slippageRate * i) / numSplits);

      let orderId = activeOrdersCopy[i].id;
      sendAmendOrder(
        marketmaker,
        orderId,
        "Long",
        true, // isPerp,
        marketId,
        buyPrice,
        MM_CONFIG.EXPIRATION_TIME,
        null,
        false, // match_only
        ACTIVE_ORDERS
      );
      // .catch((err) => {
      //   // console.log("Error amending order: ", err);
      //   errorCounter++;
      // });
    }

    for (let i = activeOrdersCopy.length; i < numSplits; i++) {
      if (
        addableBuyValue <
        DUST_AMOUNT_PER_ASSET[syntheticAsset] /
          10 ** DECIMALS_PER_ASSET[syntheticAsset]
      )
        continue;

      const buyPrice =
        midPrice *
        (1 - mmConfig.minSpread - (mmConfig.slippageRate * i) / numSplits);

      sendPerpOrder(
        marketmaker,
        "Long",
        MM_CONFIG.EXPIRATION_TIME,
        "Modify",
        position.position_header.position_address,
        syntheticAsset,
        addableBuyValue / (numSplits - activeOrdersCopy.length),
        buyPrice,
        null,
        0.07,
        0,
        false,
        ACTIVE_ORDERS
      ).catch((err) => {
        // console.log("Error sending perp order: ", err);
        errorCounter++;
      });
    }
  }

  if (["s", "d"].includes(side) && maxSize > 0) {
    // make a clone of the  ACTIVE_ORDERS[marketId + "Sell"] array
    // because we will be removing orders from it
    let activeOrdersCopy = [];
    if (ACTIVE_ORDERS[marketId + "Sell"]) {
      activeOrdersCopy = [...ACTIVE_ORDERS[marketId + "Sell"]];
    }
    for (let i = 0; i < activeOrdersCopy.length; i++) {
      const sellPrice =
        midPrice *
        (1 + mmConfig.minSpread + (mmConfig.slippageRate * i) / numSplits);

      let orderId = activeOrdersCopy[i].id;
      sendAmendOrder(
        marketmaker,
        orderId,
        "Sell",
        true, //isPerp,
        marketId,
        sellPrice,
        MM_CONFIG.EXPIRATION_TIME,
        null,
        false, // match_only
        ACTIVE_ORDERS
      );
    }

    for (let i = activeOrdersCopy.length; i < numSplits; i++) {
      if (
        addableSellValue <=
        DUST_AMOUNT_PER_ASSET[syntheticAsset] /
          10 ** DECIMALS_PER_ASSET[syntheticAsset]
      )
        continue;

      const sellPrice =
        midPrice *
        (1 + mmConfig.minSpread + (mmConfig.slippageRate * i) / numSplits);

      sendPerpOrder(
        marketmaker,
        "Short",
        MM_CONFIG.EXPIRATION_TIME,
        "Modify",
        position.position_header.position_address,
        syntheticAsset,
        addableSellValue / (numSplits - activeOrdersCopy.length),
        sellPrice,
        null,
        0.07,
        0,
        false,
        ACTIVE_ORDERS
      ).catch((err) => {
        // console.log("Error sending perp order: ", err);
        errorCounter++;
      });
    }
  }

  //
}

async function afterFill(amountFilled, marketId) {
  //
  // activeOrdersMidPrice[marketId] = null;
  // const mmConfig = MM_CONFIG.pairs[marketId];
  // if (!mmConfig) {
  //   return;
  // }
  // // ? Delay trading after fill for delayAfterFill seconds
  // if (mmConfig.delayAfterFill) {
  //   let delayAfterFillMinSize;
  //   if (
  //     !Array.isArray(mmConfig.delayAfterFill) ||
  //     !mmConfig.delayAfterFill.length > 1
  //   ) {
  //     delayAfterFillMinSize = 0;
  //   } else {
  //     delayAfterFillMinSize = mmConfig.delayAfterFill[1];
  //   }
  //   if (amountFilled > delayAfterFillMinSize) {
  //     // no array -> old config
  //     // or array and amountFilled over minSize
  //     mmConfig.active = false;
  //     cancelLiquidity(marketId);
  //     console.log(
  //       `Set ${marketId} passive for ${mmConfig.delayAfterFill} seconds.`
  //     );
  //     setTimeout(() => {
  //       mmConfig.active = true;
  //       console.log(`Set ${marketId} active.`);
  //       indicateLiquidity([marketId]);
  //     }, mmConfig.delayAfterFill * 1000);
  //   }
  // }
  // // ? increaseSpreadAfterFill size might not be set
  // const increaseSpreadAfterFillMinSize =
  //   Array.isArray(mmConfig.increaseSpreadAfterFill) &&
  //   mmConfig.increaseSpreadAfterFill.length > 2
  //     ? mmConfig.increaseSpreadAfterFill[2]
  //     : 0;
  // if (
  //   mmConfig.increaseSpreadAfterFill &&
  //   amountFilled > increaseSpreadAfterFillMinSize
  // ) {
  //   const [spread, time] = mmConfig.increaseSpreadAfterFill;
  //   mmConfig.minSpread = mmConfig.minSpread + spread;
  //   console.log(`Changed ${marketId} minSpread by ${spread}.`);
  //   indicateLiquidity(marketId);
  //   setTimeout(() => {
  //     mmConfig.minSpread = mmConfig.minSpread - spread;
  //     console.log(`Changed ${marketId} minSpread by -${spread}.`);
  //     indicateLiquidity(marketId);
  //   }, time * 1000);
  // }
  // // ? changeSizeAfterFill size might not be set
  // const changeSizeAfterFillMinSize =
  //   Array.isArray(mmConfig.changeSizeAfterFill) &&
  //   mmConfig.changeSizeAfterFill.length > 2
  //     ? mmConfig.changeSizeAfterFill[2]
  //     : 0;
  // if (
  //   mmConfig.changeSizeAfterFill &&
  //   amountFilled > changeSizeAfterFillMinSize
  // ) {
  //   const [size, time] = mmConfig.changeSizeAfterFill;
  //   mmConfig.maxSize = mmConfig.maxSize + size;
  //   console.log(`Changed ${marketId} maxSize by ${size}.`);
  //   indicateLiquidity([marketId]);
  //   setTimeout(() => {
  //     mmConfig.maxSize = mmConfig.maxSize - size;
  //     console.log(`Changed ${marketId} maxSize by ${size * -1}.`);
  //     indicateLiquidity([marketId]);
  //   }, time * 1000);
  // }
}

async function initPositions(
  marketId,
  marketmaker,
  MM_CONFIG,
  PRICE_FEEDS,
  ACTIVE_ORDERS,
  errorCounter
) {
  const mmConfig = MM_CONFIG.config;
  if (!mmConfig.active) return;

  let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

  const midPrice = PRICE_FEEDS[mmConfig.symbol]?.price;
  if (!midPrice) return;

  if (!marketmaker.positionData[syntheticAsset]) {
    // OPEN POSITION

    let margin = marketmaker.getAvailableAmount(COLLATERAL_TOKEN);

    margin = margin / 10 ** COLLATERAL_TOKEN_DECIMALS;

    if (margin < 100) return;
    let baseOpenAmount = 100.0 / midPrice;

    await sendPerpOrder(
      marketmaker,
      "Long",
      MM_CONFIG.EXPIRATION_TIME,
      "Open",
      null,
      syntheticAsset,
      baseOpenAmount,
      midPrice,
      margin,
      0.07,
      5,
      true,
      ACTIVE_ORDERS
    ).catch((err) => {
      console.log("Error sending perp order: ", err);
      errorCounter++;
    });
  }
}

module.exports = {
  fillOpenOrders,
  indicateLiquidity,
  afterFill,
  initPositions,
};
