const {
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  DUST_AMOUNT_PER_ASSET,
  PERP_MARKET_IDS_2_TOKENS,
  SPOT_MARKET_IDS_2_TOKENS,
} = require("invisible-sdk/src/utils");
const { getPrice, isOrderFillable } = require("./helpers");
const {
  sendPerpOrder,
  sendAmendOrder,
  sendSpotOrder,
  sendOpenOrderTab,
} = require("invisible-sdk/src/transactions");

/**
 * Iterates through bid and ask queues in the provided liquidity object, attempting to fill open orders.
 */
async function fillOpenOrders(
  marketId,
  liquidity,
  marketmaker,
  MM_CONFIG,
  PRICE_FEEDS,
  ACTIVE_ORDERS,
  errorCounter
) {
  let { base } = SPOT_MARKET_IDS_2_TOKENS[marketId];

  if (!liquidity[base]) return;

  if (liquidity[base].bidQueue) {
    for (let order of liquidity[base].bidQueue) {
      let fillable = isOrderFillable(order, "b", base, MM_CONFIG, PRICE_FEEDS);

      if (fillable.fillable) {
        sendFillRequest(
          order,
          "b",
          marketId,
          marketmaker,
          MM_CONFIG,
          ACTIVE_ORDERS,
          errorCounter
        );
      } else if (fillable.reason.toString() == "badprice") {
        break;
      }
    }
  }

  if (liquidity[base].askQueue.reverse()) {
    for (let order of liquidity[base].askQueue) {
      let fillable = isOrderFillable(order, "s", base, MM_CONFIG, PRICE_FEEDS);

      if (fillable.fillable) {
        sendFillRequest(
          order,
          "s",
          marketId,
          marketmaker,
          MM_CONFIG,
          ACTIVE_ORDERS,
          errorCounter
        );
      } else if (fillable.reason.toString() == "badprice") {
        break;
      }
    }
  }
}

/**
 * Sends a fill request based on market conditions and available balances.
 */
async function sendFillRequest(
  otherOrder,
  otherSide,
  marketId,
  marketmaker,
  MM_CONFIG,
  ACTIVE_ORDERS,
  errorCounter
) {
  const mmConfig = MM_CONFIG.config;
  if (!mmConfig?.active) return;

  let baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  if (!marketmaker.orderTabData[baseAsset]) return;

  let orderTab = marketmaker.orderTabData[baseAsset][0];

  let totalBaseBalance =
    orderTab.base_amount / 10 ** DECIMALS_PER_ASSET[baseAsset];
  let totalQuoteBalance =
    orderTab.quote_amount / 10 ** DECIMALS_PER_ASSET[quoteAsset];

  // sum up all the active orders
  let activeOrderBaseValue = ACTIVE_ORDERS[marketId + "Sell"]
    ? ACTIVE_ORDERS[marketId + "Sell"].reduce(
        (acc, order) => acc + order.spendAmount,
        0
      ) /
      10 ** DECIMALS_PER_ASSET[baseAsset]
    : 0;
  let activeOrderQuoteValue = ACTIVE_ORDERS[marketId + "Buy"]
    ? ACTIVE_ORDERS[marketId + "Buy"].reduce(
        (acc, order) => acc + order.spendAmount,
        0
      ) /
      10 ** DECIMALS_PER_ASSET[quoteAsset]
    : 0;

  let baseBalance = totalBaseBalance - activeOrderBaseValue;
  let quoteBalance = totalQuoteBalance - activeOrderQuoteValue;

  const spendAsset = otherSide === "s" ? quoteAsset : baseAsset;
  const baseQuantity = otherOrder.amount / 10 ** DECIMALS_PER_ASSET[baseAsset];
  const quote = genQuote(baseAsset, otherSide, baseQuantity);
  let unfilledAmount = otherSide === "s" ? quote.quoteQuantity : baseQuantity;

  if (
    (otherSide == "s" && quoteBalance > 10) ||
    (otherSide == "b" && baseBalance > 10 / otherOrder.price)
  ) {
    let orderAmount;
    if (otherSide == "s") {
      orderAmount = Math.min(quoteBalance, quote.quoteQuantity);
    } else {
      orderAmount = Math.min(baseBalance, baseQuantity);
    }

    sendSpotOrder(
      marketmaker,
      otherSide === "s" ? "Buy" : "Sell",
      MM_CONFIG.EXPIRATION_TIME,
      baseAsset,
      quoteAsset,
      orderAmount,
      orderAmount,
      otherOrder.price,
      0.07,
      0.01,
      true,
      ACTIVE_ORDERS
    ).catch((err) => {
      console.log("Error sending fill request: ", err);
      errorCounter++;
    });

    unfilledAmount -= orderAmount;
  }

  if (
    (unfilledAmount > 0,
    ACTIVE_ORDERS[otherSide === "s" ? marketId + "Buy" : marketId + "Sell"])
  ) {
    let sortedOrders = ACTIVE_ORDERS[
      otherSide === "s" ? marketId + "Buy" : marketId + "Sell"
    ].sort((a, b) => {
      return otherSide === "b" ? a.price - b.price : b.price - a.price;
    });

    for (let order of sortedOrders) {
      if (
        unfilledAmount <
        DUST_AMOUNT_PER_ASSET[spendAsset] / 10 ** DECIMALS_PER_ASSET[spendAsset]
      )
        return;

      // Send amend order
      sendAmendOrder(
        marketmaker,
        order.id,
        otherSide === "s" ? "Buy" : "Sell",
        isPerp,
        marketId,
        otherSide === "s"
          ? otherOrder.price * (1 + 0.0001)
          : otherOrder.price * (1 - 0.0001),

        MM_CONFIG.EXPIRATION_TIME,
        orderTab.tab_header.pub_key,
        true, // match_only
        ACTIVE_ORDERS,
        errorCounter
      ).catch((err) => {
        console.log("Error amending order: ", err);
        errorCounter++;
      });

      unfilledAmount -=
        order.spendAmount / 10 ** DECIMALS_PER_ASSET[spendAsset];
    }
  }
}

/**
 * Adjusts and manages liquidity by amending existing orders and placing new ones based on market conditions.
 */
async function indicateLiquidity(
  marketId,
  marketmaker,
  MM_CONFIG,
  PRICE_FEEDS,
  ACTIVE_ORDERS,
  errorCounter
) {
  if (!marketmaker) return;

  const mmConfig = MM_CONFIG.config;
  if (!mmConfig?.active) return;

  let baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  const midPrice = PRICE_FEEDS[mmConfig.symbol]?.price;
  if (!midPrice) return;

  if (!marketmaker.orderTabData[baseAsset]) return;

  const side = mmConfig.side || "d";

  let orderTab = marketmaker.orderTabData[baseAsset][0];

  let totalBaseBalance =
    orderTab.base_amount / 10 ** DECIMALS_PER_ASSET[baseAsset];
  let totalQuoteBalance =
    orderTab.quote_amount / 10 ** DECIMALS_PER_ASSET[quoteAsset];

  // sum up all the active orders
  let activeOrderBaseValue = ACTIVE_ORDERS[marketId + "Sell"]
    ? ACTIVE_ORDERS[marketId + "Sell"].reduce(
        (acc, order) => acc + order.spendAmount,
        0
      ) /
      10 ** DECIMALS_PER_ASSET[baseAsset]
    : 0;
  let activeOrderQuoteValue = ACTIVE_ORDERS[marketId + "Buy"]
    ? ACTIVE_ORDERS[marketId + "Buy"].reduce(
        (acc, order) => acc + order.spendAmount,
        0
      ) /
      10 ** DECIMALS_PER_ASSET[quoteAsset]
    : 0;

  let baseBalance = totalBaseBalance - activeOrderBaseValue;
  let quoteBalance = totalQuoteBalance - activeOrderQuoteValue;

  const maxSellSize = Math.min(totalBaseBalance, mmConfig.maxSize);
  const maxBuySize = Math.min(totalQuoteBalance / midPrice, mmConfig.maxSize);

  let buySplits = mmConfig.numOrdersIndicated || 4;
  let sellSplits = mmConfig.numOrdersIndicated || 4;

  if (
    maxSellSize * getPrice(baseAsset, MM_CONFIG, PRICE_FEEDS) < 100 ||
    maxBuySize * getPrice(baseAsset, MM_CONFIG, PRICE_FEEDS) < 100
  )
    return;

  if (["b", "d"].includes(side)) {
    let activeOrdersCopy = [];
    if (ACTIVE_ORDERS[marketId + "Buy"]) {
      activeOrdersCopy = [...ACTIVE_ORDERS[marketId + "Buy"]];
    }

    // & AMEND EXISTING ORDERS -----------------------------------------------------
    for (let i = 0; i < activeOrdersCopy.length; i++) {
      const buyPrice =
        midPrice *
        (1 -
          mmConfig.minSpread -
          (mmConfig.slippageRate * maxBuySize * i) / buySplits);

      let orderId = activeOrdersCopy[i].id;
      sendAmendOrder(
        marketmaker,
        orderId,
        "Buy",
        isPerp,
        marketId,
        buyPrice,
        MM_CONFIG.EXPIRATION_TIME,
        orderTab.tab_header.pub_key,
        false, // match_only
        ACTIVE_ORDERS,
        errorCounter
      ).catch((err) => {
        console.log("Error amending order: ", err);
        errorCounter++;
      });
    }

    // & SEND NEW ORDERS -----------------------------------------------------
    for (let i = activeOrdersCopy.length; i < buySplits; i++) {
      if (
        quoteBalance <
        DUST_AMOUNT_PER_ASSET[quoteAsset] / 10 ** DECIMALS_PER_ASSET[quoteAsset]
      )
        continue;

      const buyPrice =
        midPrice *
        (1 -
          mmConfig.minSpread -
          (mmConfig.slippageRate * maxBuySize * i) / buySplits);
      let quote_amount = quoteBalance / buySplits;

      await sendSpotOrder(
        marketmaker,
        "Buy",
        MM_CONFIG.EXPIRATION_TIME,
        baseAsset,
        quoteAsset,
        null,
        quote_amount,
        buyPrice,
        0.07,
        orderTab.tab_header.pub_key,
        0,
        false,
        ACTIVE_ORDERS
      ).catch((err) => {
        console.log("Error sending spot order: ", err);

        // if (
        //   err.toString().includes("Note does not exist") ||
        //   err.toString().includes("Position does not exist")
        // ) {
        //   // restoreUserState(user, true, true);
        //   shouldRestoreState = true;
        // }

        errorCounter++;
      });
    }
  }

  if (["s", "d"].includes(side) && maxSellSize > 0) {
    // make a clone of the  ACTIVE_ORDERS[marketId + "Sell"] array
    // because we will be removing orders from it
    let activeOrdersCopy = [];
    if (ACTIVE_ORDERS[marketId + "Sell"]) {
      activeOrdersCopy = [...ACTIVE_ORDERS[marketId + "Sell"]];
    }

    // & AMEND EXISTING ORDERS -----------------------------------------------------
    for (let i = 0; i < activeOrdersCopy.length; i++) {
      const sellPrice =
        midPrice *
        (1 +
          mmConfig.minSpread +
          (mmConfig.slippageRate * maxSellSize * i) / sellSplits);

      let orderId = activeOrdersCopy[i].id;
      sendAmendOrder(
        marketmaker,
        orderId,
        "Sell",
        isPerp,
        marketId,
        sellPrice,
        MM_CONFIG.EXPIRATION_TIME,
        orderTab.tab_header.pub_key,
        false, // match_only
        ACTIVE_ORDERS,
        errorCounter
      ).catch((err) => {
        console.log("Error amending order: ", err);
        errorCounter++;
      });
    }

    // & SEND NEW ORDERS -----------------------------------------------------
    for (let i = activeOrdersCopy.length; i < sellSplits; i++) {
      if (
        baseBalance <
        DUST_AMOUNT_PER_ASSET[baseAsset] / 10 ** DECIMALS_PER_ASSET[baseAsset]
      )
        continue;

      const sellPrice =
        midPrice *
        (1 +
          mmConfig.minSpread +
          (mmConfig.slippageRate * maxSellSize * i) / sellSplits);
      let base_amount = baseBalance / sellSplits;

      await sendSpotOrder(
        marketmaker,
        "Sell",
        MM_CONFIG.EXPIRATION_TIME,
        baseAsset,
        quoteAsset,
        base_amount,
        null,
        sellPrice,
        0.07,
        orderTab.tab_header.pub_key,
        0,
        false,
        ACTIVE_ORDERS
      ).catch((err) => {
        console.log("Error sending spot order: ", err);

        // if (
        //   err.toString().includes("Note does not exist") ||
        //   err.toString().includes("Position does not exist")
        // ) {
        //   // restoreUserState(user, true, true);
        //   shouldRestoreState = true;
        // }

        errorCounter++;
      });
    }
  }
}

async function afterFill(amountFilled, marketId) {
  // TODO: insert logic here
}

/**
 * Opens an orderTab if none exists.
 */
async function initOrderTab(marketId, marketmaker, MM_CONFIG, PRICE_FEEDS) {
  const mmConfig = MM_CONFIG.config;
  if (!mmConfig.active) return;

  let { base, quote } = SPOT_MARKET_IDS_2_TOKENS[marketId];

  if (!marketmaker.orderTabData[base]) {
    // OPEN ORDER TAB

    let baseAmount = marketmaker.getAvailableAmount(base);
    let quoteAmount = marketmaker.getAvailableAmount(quote);

    await sendOpenOrderTab(
      marketmaker,
      baseAmount,
      quoteAmount,
      marketId,
      3600_000
    );
  }
}

module.exports = {
  fillOpenOrders,
  indicateLiquidity,
  afterFill,
  initPositions,
  initOrderTab,
};
