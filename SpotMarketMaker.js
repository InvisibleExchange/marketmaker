const User = require("./src/users/Invisibl3User");

const dotenv = require("dotenv");
dotenv.config();

const {
  SERVER_URL,
  COLLATERAL_TOKEN,
  COLLATERAL_TOKEN_DECIMALS,
  DECIMALS_PER_ASSET,
  handleNoteSplit,
  SPOT_MARKET_IDS_2_TOKENS,
  SYMBOLS_TO_IDS,
  SPOT_MARKET_IDS,
  getActiveOrders,
  IDS_TO_SYMBOLS,
  handleLiquidityUpdate,
  handleSwapResult,
  handlePerpSwapResult,
  DUST_AMOUNT_PER_ASSET,
} = require("./src/helpers/utils");

const {
  sendSpotOrder,
  sendAmendOrder,
  sendCancelOrder,
} = require("./src/transactions/constructOrders");

const { setupPriceFeeds } = require("./mmPriceFeeds");
const { trimHash } = require("./src/transactions/stateStructs/Notes");
const { restoreUserState } = require("./src/helpers/keyRetrieval");

let W3CWebSocket = require("websocket").w3cwebsocket;
let client;

let errorCounter = 0;

let MM_CONFIG, activeMarkets;

dotenv.config();

// How often do we refresh entire state (to prevent bugs and have a fresh version of the state)
const REFRESH_PERIOD = 10_800_000; // 3 hours
// How often do we send liquidity indications (orders that make the market)
const LIQUIDITY_INDICATION_PERIOD = 5_000; // 5 seconds
// Cancel all orders and send new ones
const REFRESH_ORDERS_PERIOD = 123_000; // 2 minutes
// How often do we check if any orders can be filled
const FILL_ORDERS_PERIOD = 1_000; // 1 seconds

// Globals
const PRICE_FEEDS = {};
let liquidity = {};
const setLiquidity = (liq) => {
  liquidity = liq;
};
let perpLiquidity = {};
const setPerpLiquidity = (liq) => {
  perpLiquidity = liq;
};

// Maps marketId to a list of active orders
let ACTIVE_ORDERS = {}; // { id, spendAmount, price }

let marketMaker;
const isPerp = false;
let shouldRestoreState = false;

//
async function fillOpenOrders() {
  for (let marketId of Object.values(SPOT_MARKET_IDS)) {
    if (!activeMarkets.includes(marketId.toString())) continue;

    let { base, quote } = SPOT_MARKET_IDS_2_TOKENS[marketId];

    if (!liquidity[base]) continue;

    if (liquidity[base].bidQueue) {
      for (let order of liquidity[base].bidQueue) {
        let fillable = isOrderFillable(order, "b", base, quote);

        if (fillable.fillable) {
          sendFillRequest(order, "b", marketId);
        } else if (fillable.reason.toString() == "badprice") {
          break;
        }
      }
    }

    if (liquidity[base].askQueue.reverse()) {
      for (let order of liquidity[base].askQueue) {
        let fillable = isOrderFillable(order, "s", base, quote);

        if (fillable.fillable) {
          sendFillRequest(order, "s", marketId);
        } else if (fillable.reason.toString() == "badprice") {
          break;
        }
      }
    }
  }
}

// order: {price, amount, timestamp}
async function sendFillRequest(otherOrder, otherSide, marketId) {
  const mmConfig = MM_CONFIG.pairs[marketId];
  if (!mmConfig || !mmConfig.active) return;

  let baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
  let quoteAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

  if (!marketMaker.orderTabData[baseAsset]) return;

  let orderTab = marketMaker.orderTabData[baseAsset][0];

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

  // TODO: ==============================================================

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
      marketMaker,
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
        marketMaker,
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

async function indicateLiquidity(marketIds = activeMarkets) {
  if (!marketMaker) return;

  for (const marketId of marketIds) {
    const mmConfig = MM_CONFIG.pairs[marketId];
    if (!mmConfig || !mmConfig.active) continue;

    let baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;
    let quoteAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].quote;

    try {
      validatePriceFeed(baseAsset);
    } catch (e) {
      console.error(
        "Can not indicateLiquidity (" +
          IDS_TO_SYMBOLS[baseAsset] +
          ") because: " +
          e
      );
      continue;
    }

    const midPrice = mmConfig.invert
      ? 1 / PRICE_FEEDS[mmConfig.priceFeedPrimary]
      : PRICE_FEEDS[mmConfig.priceFeedPrimary];
    if (!midPrice) continue;

    if (!marketMaker.orderTabData[baseAsset]) continue;

    const side = mmConfig.side || "d";

    let orderTab = marketMaker.orderTabData[baseAsset][0];

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
      maxSellSize * getPrice(baseAsset) < 100 ||
      maxBuySize * getPrice(baseAsset) < 100
    )
      continue;

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
          marketMaker,
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
          DUST_AMOUNT_PER_ASSET[quoteAsset] /
            10 ** DECIMALS_PER_ASSET[quoteAsset]
        )
          continue;

        const buyPrice =
          midPrice *
          (1 -
            mmConfig.minSpread -
            (mmConfig.slippageRate * maxBuySize * i) / buySplits);
        let quote_amount = quoteBalance / buySplits;

        await sendSpotOrder(
          marketMaker,
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

          if (
            err.toString().includes("Note does not exist") ||
            err.toString().includes("Position does not exist")
          ) {
            // restoreUserState(user, true, true);
            shouldRestoreState = true;
          }

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
          marketMaker,
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
          marketMaker,
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

          if (
            err.toString().includes("Note does not exist") ||
            err.toString().includes("Position does not exist")
          ) {
            // restoreUserState(user, true, true);
            shouldRestoreState = true;
          }

          errorCounter++;
        });
      }
    }

    //
  }
}

async function cancelLiquidity(marketId) {
  let baseAsset = SPOT_MARKET_IDS_2_TOKENS[marketId].base;

  let counter = 0;
  let baseIds = [];
  for (order of marketMaker.orders) {
    if (
      order.token_spent == baseAsset ||
      order.token_received == baseAsset ||
      order.base_asset == baseAsset
    ) {
      // {base_asset,expiration_timestamp,fee_limit,notes_in,order_id,order_side,price,qty_left,quote_asset,refund_note}
      // true-BID, false-ASK

      let isBuyOrder = order.token_received
        ? order.token_received == baseAsset
        : order.order_side;

      let dontUpdateState = baseIds.includes(order.order_id);
      baseIds.push(order.order_id);

      sendCancelOrder(
        marketMaker,
        order.order_id,
        isBuyOrder,
        isPerp,
        marketId,
        errorCounter,
        dontUpdateState
      )
        .then(() => {
          counter++;
        })
        .catch((err) => {
          console.log("Error canceling order: ", err);
        });
    } else {
      counter++;
    }
  }

  while (counter < marketMaker.orders.length) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function afterFill(amountFilled, marketId) {
  // TODO
  // const mmConfig = MM_CONFIG.pairs[marketId];
  // if (!mmConfig) {
  //   return;
  // }
  // // ? Delay trading after fill for delayAfterFill seconds
  // if (mmConfig.delayAfterFill) {
  //   let delayAfterFillMinSize = mmConfig.delayAfterFillMinSize
  //     ? mmConfig.delayAfterFillMinSize
  //     : 0;
  //   if (amountFilled > delayAfterFillMinSize) {
  //     // no array -> old config
  //     // or array and amountFilled over minSize
  //     mmConfig.active = false;
  //     await cancelLiquidity(marketId);
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

// * HELPER FUNCTIONS ========================================================================================================

//order: {price, amount, timestamp}
function isOrderFillable(order, side, baseAsset, quoteAsset) {
  // const chainId = order[0];
  // const marketId = order[2];
  // const market = MARKETS[marketId];
  const mmConfig = MM_CONFIG.pairs[SPOT_MARKET_IDS[baseAsset]];
  const mmSide = mmConfig.side ? mmConfig.side : "d";
  // if (!market) return { fillable: false, reason: "badmarket" };
  if (!mmConfig.active) return { fillable: false, reason: "inactivemarket" };

  const price = order.price;
  const baseQuantity = order.amount / 10 ** DECIMALS_PER_ASSET[baseAsset];

  if (mmSide !== "d" && mmSide == side) {
    return { fillable: false, reason: "badside" };
  }

  if (baseQuantity < mmConfig.minSize || baseQuantity > mmConfig.maxSize) {
    return { fillable: false, reason: "badsize" };
  }

  let quote;
  try {
    quote = genQuote(baseAsset, side, baseQuantity);
  } catch (e) {
    return { fillable: false, reason: e.message };
  }
  if (
    (side == "s" && price > quote.quotePrice) ||
    (side == "b" && price < quote.quotePrice)
  ) {
    return { fillable: false, reason: "badprice" };
  }

  return { fillable: true, reason: null };
}

function genQuote(baseAsset, side, baseQuantity) {
  if (!baseAsset) throw new Error("badmarket");
  if (!["b", "s"].includes(side)) throw new Error("badside");
  if (baseQuantity <= 0) throw new Error("badquantity");

  validatePriceFeed(baseAsset);

  const mmConfig = MM_CONFIG.pairs[SPOT_MARKET_IDS[baseAsset]];
  const mmSide = mmConfig.side || "d";
  if (mmSide !== "d" && mmSide === side) {
    throw new Error("badside");
  }

  const primaryPrice = mmConfig.invert
    ? 1 / PRICE_FEEDS[mmConfig.priceFeedPrimary]
    : PRICE_FEEDS[mmConfig.priceFeedPrimary];
  if (!primaryPrice) throw new Error("badprice");

  const SPREAD = mmConfig.minSpread + baseQuantity * mmConfig.slippageRate;

  let quotePrice;
  let quoteQuantity;
  if (side === "b") {
    quotePrice = Number((primaryPrice * (1 + SPREAD + 0.0007)).toPrecision(6));
    quoteQuantity = baseQuantity * quotePrice;
  } else if (side === "s") {
    quotePrice = Number((primaryPrice * (1 - SPREAD - 0.0007)).toPrecision(6));
    quoteQuantity = baseQuantity * quotePrice;
  }

  if (quotePrice < 0) throw new Error("Amount is inadequate to pay fee");
  if (isNaN(quotePrice)) throw new Error("Internal Error. No price generated.");

  return { quotePrice, quoteQuantity };
}

function validatePriceFeed(baseAsset) {
  const mmConfig = MM_CONFIG.pairs[SPOT_MARKET_IDS[baseAsset]];
  const primaryPriceFeedId = mmConfig.priceFeedPrimary;
  const secondaryPriceFeedId = mmConfig.priceFeedSecondary;

  // Constant mode checks
  const [mode, price] = primaryPriceFeedId.split(":");
  if (mode === "constant") {
    if (price > 0) return true;
    else throw new Error("No initPrice available");
  }

  // Check if primary price exists
  const primaryPrice = PRICE_FEEDS[primaryPriceFeedId];
  if (!primaryPrice) throw new Error("Primary price feed unavailable");

  // If there is no secondary price feed, the price auto-validates
  if (!secondaryPriceFeedId) return true;

  // Check if secondary price exists
  const secondaryPrice = PRICE_FEEDS[secondaryPriceFeedId];
  if (!secondaryPrice) throw new Error("Secondary price feed unavailable");

  // If the secondary price feed varies from the primary price feed by more than 1%, assume something is broken
  const percentDiff = Math.abs(primaryPrice - secondaryPrice) / primaryPrice;
  if (percentDiff > 0.03) {
    console.error("Primary and secondary price feeds do not match!");
    throw new Error("Circuit breaker triggered");
  }

  return true;
}

const getPrice = (token) => {
  if (token == COLLATERAL_TOKEN) {
    return 1;
  }

  return PRICE_FEEDS[MM_CONFIG.pairs[SPOT_MARKET_IDS[token]].priceFeedPrimary];
};

// * INITIALIZATION ========================================================================================================

const CONFIG_CODE = "1234567890";
const listenToWebSocket = () => {
  client = new W3CWebSocket(`ws://${MM_CONFIG.SERVER_URL}:50053`);

  client.onopen = function () {
    const ID = trimHash(marketMaker.userId, 64);
    client.send(
      JSON.stringify({ user_id: ID.toString(), config_code: CONFIG_CODE })
    );
    console.log("WebSocket Client Connected");
  };

  client.onmessage = function (e) {
    let msg = JSON.parse(e.data);

    // 1.)
    // "message_id": LIQUIDITY_UPDATE,
    // "type": "perpetual"/"spot"
    // "market":  11 / 12 / 21 / 22
    // "ask_liquidity": [ [price, size, timestamp], [price, size, timestamp], ... ]
    // "bid_liquidity": [ [price, size, timestamp], [price, size, timestamp], ... ]

    // 2.)
    // "message_id": "PERPETUAL_SWAP",
    // "order_id": u64,
    // "swap_response": responseObject,
    // -> handlePerpSwapResult(user, responseObject)

    // 3.)
    // "message_id": "SWAP_RESULT",
    // "order_id": u64,
    // "market_id": u16,
    // "swap_response": responseObject,
    // -> handleSwapResult(user, responseObject)

    // 4.)
    // "message_id": "SWAP_FILLED",
    // "type": "perpetual"/"spot"
    // "asset":  tokenId
    // "amount":  amount
    // "price":  price
    // "is_buy":  isBuy
    // "timestamp":  timestamp

    switch (msg.message_id) {
      case "LIQUIDITY_UPDATE":
        handleLiquidityUpdate(
          msg,
          liquidity,
          setLiquidity,
          perpLiquidity,
          setPerpLiquidity
        );
        break;

      case "SWAP_FILLED":
        // if (msg.type == "perpetual") {
        //   // handleFillResult(marketMaker, msg, perpFills, setPerpFills);
        // } else {
        //   // handleFillResult(marketMaker, msg, fills, setFills);
        // }

        break;

      case "SWAP_RESULT":
        handleSwapResult(
          marketMaker,
          msg.order_id,
          msg.spent_amount,
          msg.received_amount,
          msg.swap_response.note_info_swap_response,
          msg.market_id,
          ACTIVE_ORDERS
        );

        afterFill(msg.swap_response.new_amount_filled, msg.market_id);

        break;

      case "PERPETUAL_SWAP":
        handlePerpSwapResult(marketMaker, msg.order_id, msg.swap_response);

        break;

      default:
        break;
    }
  };

  client.onclose = function () {
    setTimeout(() => {
      listenToWebSocket();
    }, 5000);
  };
};

const initAccountState = async () => {
  try {
    let user_ = User.fromPrivKey(MM_CONFIG.privKey);

    let { emptyPrivKeys, emptyPositionPrivKeys } = await user_.login();

    let { badOrderIds, orders, badPerpOrderIds, perpOrders, pfrNotes } =
      await getActiveOrders(user_.orderIds, user_.perpetualOrderIds);

    await user_.handleActiveOrders(
      badOrderIds,
      orders,
      badPerpOrderIds,
      perpOrders,
      pfrNotes,
      emptyPrivKeys,
      emptyPositionPrivKeys
    );

    marketMaker = user_;

    // cancel open orders
    for (let marketId of Object.values(SPOT_MARKET_IDS)) {
      const mmConfig = MM_CONFIG.pairs[marketId];
      if (!mmConfig || !mmConfig.active) continue;

      if (marketMaker) {
        await cancelLiquidity(marketId);
      }
    }

    ACTIVE_ORDERS = {};
  } catch (error) {
    console.log("login error", error);
    // throw error;
  }
};

// * MAIN ==================================================================================================================

let restoredKeys = false;
async function run(config) {
  return new Promise(async (resolve, reject) => {
    MM_CONFIG = config.MM_CONFIG;
    activeMarkets = config.activeMarkets;

    // Setup price feeds
    try {
      await setupPriceFeeds(MM_CONFIG, PRICE_FEEDS);
    } catch (error) {
      console.log("Error setting up price feeds: ", error);
    }

    // Setup the market maker
    await runWithTimeout(initAccountState, 30_000);

    // Strart listening to updates from the server
    if (!client || client.readyState !== client.OPEN) {
      listenToWebSocket();
    }

    // Check for fillable orders
    let fillInterval = setInterval(fillOpenOrders, FILL_ORDERS_PERIOD);

    let baseToken = SYMBOLS_TO_IDS[config.baseToken];

    let orderTab = marketMaker.orderTabData[baseToken][0];
    console.log(
      "Starting market making: ",
      orderTab.quote_amount,
      "USDC",
      orderTab.base_amount,
      config.baseToken.toString()
    );

    // if (
    //   (baseAmount < DUST_AMOUNT_PER_ASSET[baseToken] ||
    //     quoteAmount < DUST_AMOUNT_PER_ASSET[55555]) &&
    //   !restoredKeys
    // ) {
    //   await restoreUserState(marketMaker, true, false);
    //   restoredKeys = true;

    //   clearInterval(fillInterval);

    //   return await run(config);
    // }

    // brodcast orders to provide liquidity
    indicateLiquidity();
    let brodcastInterval = setInterval(
      indicateLiquidity,
      LIQUIDITY_INDICATION_PERIOD
    );

    let errorInterval = setInterval(() => {
      if (errorCounter >= 4 || shouldRestoreState) {
        clearInterval(fillInterval);
        clearInterval(brodcastInterval);
        clearInterval(errorInterval);
        clearInterval(refreshInterval);
        reject("Too many errors. Restarting...");
      }

      errorCounter = Math.max(0, errorCounter - 2);
    }, 2 * LIQUIDITY_INDICATION_PERIOD);

    let refreshInterval = setInterval(async () => {
      let res = await refreshOrders(fillInterval, brodcastInterval);
      fillInterval = res.fillInterval;
      brodcastInterval = res.brodcastInterval;
    }, REFRESH_ORDERS_PERIOD);

    await new Promise((resolve) => setTimeout(resolve, REFRESH_PERIOD));
    clearInterval(fillInterval);
    clearInterval(brodcastInterval);
    clearInterval(errorInterval);
    clearInterval(refreshInterval);

    resolve();
  });
}

// =========================================================================================

let restartCount = 0;
module.exports = async function runMarketmaker(config) {
  setInterval(() => {
    restartCount = 0;
  }, REFRESH_PERIOD); // 1 hour

  await safeRun(config);
};

async function safeRun(config) {
  try {
    await run(config);

    if (marketMaker && shouldRestoreState) {
      await restoreUserState(marketMaker, true, false);
      shouldRestoreState = false;
    }

    await safeRun(config);
  } catch (error) {
    restartCount++;
    console.log("Error: ", error);

    if (marketMaker && shouldRestoreState) {
      await restoreUserState(marketMaker, true, false);
      shouldRestoreState = false;
    }

    if (restartCount >= 5) {
      console.log("Too many restarts. Exiting...");
      // TODO: Maybe send a notification to the user that the bot is down
      process.exit(1);
    }

    await safeRun(config);
  }
}

//
//
//
//
//

const refreshOrders = async (fillInterval, brodcastInterval) => {
  clearInterval(fillInterval);
  clearInterval(brodcastInterval);

  // cancel open orders
  for (let marketId of Object.values(SPOT_MARKET_IDS)) {
    const mmConfig = MM_CONFIG.pairs[marketId];

    if (!mmConfig || !mmConfig.active) continue;

    if (marketMaker) {
      await cancelLiquidity(marketId);
    }
  }

  ACTIVE_ORDERS = {};

  // brodcast orders to provide liquidity
  indicateLiquidity();
  brodcastInterval = setInterval(
    indicateLiquidity,
    LIQUIDITY_INDICATION_PERIOD
  );

  fillInterval = setInterval(fillOpenOrders, FILL_ORDERS_PERIOD);

  return { fillInterval, brodcastInterval };
};

// ===================================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithTimeout(asyncFn, timeout) {
  const timeoutPromise = delay(timeout).then(() => {
    throw new Error("Timeout");
  });

  await Promise.race([asyncFn(), timeoutPromise]);
}
