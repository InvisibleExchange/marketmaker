//

const {
  DECIMALS_PER_ASSET,
  COLLATERAL_TOKEN,
} = require("invisible-sdk/src/utils");

function isOrderFillable(order, side, baseAsset, MM_CONFIG, PRICE_FEEDS) {
  const mmConfig = MM_CONFIG.config;
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
    quote = genQuote(baseAsset, side, baseQuantity, MM_CONFIG, PRICE_FEEDS);
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

function genQuote(baseAsset, side, baseQuantity, MM_CONFIG, PRICE_FEEDS) {
  if (!baseAsset) throw new Error("badmarket");
  if (!["b", "s"].includes(side)) throw new Error("badside");
  if (baseQuantity <= 0) throw new Error("badquantity");

  const mmConfig = MM_CONFIG.config;
  const mmSide = mmConfig.side || "d";
  if (mmSide !== "d" && mmSide === side) {
    throw new Error("badside");
  }

  const primaryPrice = PRICE_FEEDS[mmConfig.symbol]?.price;
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

const getPrice = (token, MM_CONFIG, PRICE_FEEDS) => {
  if (token == COLLATERAL_TOKEN) {
    return 1;
  }

  return PRICE_FEEDS[MM_CONFIG.config.symbol].price;
};

module.exports = { isOrderFillable, genQuote, getPrice };
