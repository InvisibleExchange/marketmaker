const {
  DECIMALS_PER_ASSET,
  PRICE_DECIMALS_PER_ASSET,
  COLLATERAL_TOKEN_DECIMALS,
} = require("./utils");

// calculate prices

const LEVERAGE_BOUNDS_PER_ASSET = {
  12345: [1.5, 30.0], // BTC
  54321: [15.0, 150.0], // ETH
};
const MAX_LEVERAGE = 15;

const MIN_PARTIAL_LIQUIDATION_SIZE = {
  12345: 50_000_000,
  54321: 500_000_000,
};

function _getBankruptcyPrice(
  entryPrice,
  margin,
  size,
  orderSide,
  syntheticToken
) {
  const syntheticDecimals = DECIMALS_PER_ASSET[syntheticToken];
  const syntheticPriceDecimals = PRICE_DECIMALS_PER_ASSET[syntheticToken];

  const decConversion1 =
    syntheticPriceDecimals - COLLATERAL_TOKEN_DECIMALS + syntheticDecimals;
  const multiplier1 = 10 ** decConversion1;

  if (orderSide == "Long" || orderSide == 0) {
    const bp =
      Math.floor(entryPrice) - Math.floor((margin * multiplier1) / size);

    return Math.max(0, bp);
  } else {
    const bp =
      Math.floor(entryPrice) + Math.floor((margin * multiplier1) / size);
    return Math.max(0, bp);
  }
}

function _getLiquidationPrice(
  entryPrice,
  margin,
  position_size,
  orderSide,
  syntheticToken,
  is_partial_liquidation
) {
  entryPrice = Number.parseInt(entryPrice);
  margin = Number.parseInt(margin);
  position_size = Number.parseInt(position_size);

  let mm_fraction =
    is_partial_liquidation &&
    position_size > MIN_PARTIAL_LIQUIDATION_SIZE[syntheticToken]
      ? 4
      : 3;

  const syntheticDecimals = DECIMALS_PER_ASSET[syntheticToken];
  const syntheticPriceDecimals = PRICE_DECIMALS_PER_ASSET[syntheticToken];

  const decConversion1 =
    syntheticDecimals + syntheticPriceDecimals - COLLATERAL_TOKEN_DECIMALS;
  const multiplier1 = 10 ** decConversion1;

  // & price_delta = (margin - mm_fraction * entry_price * size) / ((1 -/+ mm_fraction)*size) ; - for long, + for short

  let d1 = margin * multiplier1;
  let d2 = (mm_fraction * entryPrice * position_size) / 100;

  if (orderSide == "Long" || orderSide == 1) {
    if (position_size == 0) {
      return 0;
    }

    let price_delta = ((d1 - d2) * 100) / ((100 - mm_fraction) * position_size);

    let liquidation_price = entryPrice - Number.parseInt(price_delta);

    return Math.max(liquidation_price, 0);
  } else {
    if (position_size == 0) {
      return 0;
    }

    let price_delta = ((d1 - d2) * 100) / ((100 + mm_fraction) * position_size);

    let liquidation_price = entryPrice + Number.parseInt(price_delta);

    return liquidation_price;
  }
}

function calcAvgEntryInIncreaseSize(position, sizeChange, indexPrice) {
  let scaledPrice =
    Number(indexPrice) *
    10 ** PRICE_DECIMALS_PER_ASSET[position.synthetic_token];
  let scaledSize =
    Number(sizeChange) * 10 ** DECIMALS_PER_ASSET[position.synthetic_token];

  let avgEntryPrice =
    (Number(position.position_size) * Number(position.entry_price) +
      scaledSize * scaledPrice) /
    (Number(position.position_size) + scaledSize);

  return (
    avgEntryPrice / 10 ** PRICE_DECIMALS_PER_ASSET[position.synthetic_token]
  );
}

// * Calculate liquidation prices

function calulateLiqPriceInMarginChangeModal(position, marginChange) {
  marginChange = marginChange * 10 ** COLLATERAL_TOKEN_DECIMALS;

  let liqPrice = _getLiquidationPrice(
    Number(position.entry_price),
    Number(position.margin) + marginChange,
    Number(position.position_size),
    position.order_side,
    position.synthetic_token,
    true
  );

  return Math.max(liqPrice, 0);
}

function calulateLiqPriceInIncreaseSize(position, sizeChange, indexPrice) {
  let scaledPrice =
    Number(indexPrice) *
    10 ** PRICE_DECIMALS_PER_ASSET[position.synthetic_token];
  let scaledSize =
    Number(sizeChange) * 10 ** DECIMALS_PER_ASSET[position.synthetic_token];

  let avgEntryPrice =
    (Number(position.position_size) * Number(position.entry_price) +
      scaledSize * scaledPrice) /
    (Number(position.position_size) + scaledSize);

  let liqPrice = _getLiquidationPrice(
    avgEntryPrice,
    Number(position.margin),
    Number(position.position_size) + scaledSize,
    position.order_side,
    position.synthetic_token,
    true
  );

  return Math.max(liqPrice, 0);
}

function calulateLiqPriceInDecreaseSize(position, sizeChange) {
  let scaledSize =
    Number(sizeChange) * 10 ** DECIMALS_PER_ASSET[position.synthetic_token];

  let new_size = Number(position.position_size) - scaledSize;

  let liqPrice = _getLiquidationPrice(
    Number(position.entry_price),
    Number(position.margin),
    new_size,
    position.order_side,
    position.synthetic_token,
    true
  );

  return Math.max(liqPrice, 0);
}

function calulateLiqPriceInFlipSide(position, sizeChange, indexPrice) {
  let scaledSize =
    Number(sizeChange) * 10 ** DECIMALS_PER_ASSET[position.synthetic_token];
  let scaledPrice =
    Number(indexPrice) *
    10 ** PRICE_DECIMALS_PER_ASSET[position.synthetic_token];

  let new_size = scaledSize - Number(position.position_size);

  let newOrderSide = position.order_side == "Long" ? "Short" : "Long";

  let liqPrice = _getLiquidationPrice(
    scaledPrice,
    Number(position.margin),
    new_size,
    newOrderSide,
    position.synthetic_token,
    true
  );

  return Math.max(liqPrice, 0);
}

// * Calculate leverage and min viable margin

function getSizeFromLeverage(indexPrice, leverage, margin) {
  if (indexPrice == 0) {
    return 0;
  }

  const size = (Number(margin) * Number(leverage)) / Number(indexPrice);

  return size;
}

function getCurrentLeverage(indexPrice, size, margin) {
  if (indexPrice == 0) {
    return 0;
  }

  const currentLeverage = (Number(indexPrice) * Number(size)) / Number(margin);

  return currentLeverage;
}

function getMinViableMargin(position) {
  const maxLeverage = getMaxLeverage(
    Number(position.synthetic_token),
    Number(position.position_size) /
      10 ** DECIMALS_PER_ASSET[position.synthetic_token]
  );

  let maxLiquidationPrice =
    (1 - 1 / maxLeverage) * Number(position.entry_price);

  let multiplier =
    10 **
    (DECIMALS_PER_ASSET[position.synthetic_token] +
      PRICE_DECIMALS_PER_ASSET[position.synthetic_token] -
      COLLATERAL_TOKEN_DECIMALS);

  let minMargin =
    (Number(position.position_size) * maxLiquidationPrice) / maxLeverage;
  minMargin = minMargin / multiplier;

  return minMargin;
}

function getMaxLeverage(token, amount) {
  let [min_bound, max_bound] = LEVERAGE_BOUNDS_PER_ASSET[token];

  let maxLev;
  if (amount < min_bound) {
    maxLev = MAX_LEVERAGE;
  } else if (amount < max_bound) {
    // b. For trades between $100,000 and $1,000,000, reduce the maximum leverage proportionally, such as 50 * ($100,000/$trade size).

    maxLev = MAX_LEVERAGE * (min_bound / amount);
  } else {
    maxLev = 1;
  }

  return maxLev;
}

function getNewMaxLeverage(margin, indexPrice, token) {
  let min_bound = LEVERAGE_BOUNDS_PER_ASSET[token][0];

  let temp = (MAX_LEVERAGE * margin * min_bound) / Number(indexPrice);

  let newMaxSize = Math.sqrt(temp);
  let newMaxLeverage = getCurrentLeverage(indexPrice, newMaxSize, margin);

  if (newMaxLeverage > MAX_LEVERAGE) {
    newMaxLeverage = MAX_LEVERAGE;
    newMaxSize = (MAX_LEVERAGE * margin) / Number(indexPrice);
  } else if (newMaxLeverage < 1) {
    newMaxLeverage = 1;
    newMaxSize = margin / Number(indexPrice);
  }

  return { newMaxLeverage, newMaxSize };
}
// * Check vaible sizes

function checkViableSizeAfterIncrease(position, added_size, added_price) {
  let new_size =
    Number(position.position_size) /
      10 ** DECIMALS_PER_ASSET[position.synthetic_token] +
    Number(added_size);

  const maxLeverage = getMaxLeverage(position.synthetic_token, new_size);

  let scaledPrice =
    Number(added_price) *
    10 ** PRICE_DECIMALS_PER_ASSET[position.synthetic_token];
  let scaledSize =
    Number(added_size) * 10 ** DECIMALS_PER_ASSET[position.synthetic_token];

  let avgEntryPrice =
    (Number(position.position_size) * Number(position.entry_price) +
      scaledSize * scaledPrice) /
    (Number(position.position_size) + scaledSize);

  let leverage =
    ((Number(position.position_size) + scaledSize) * avgEntryPrice) /
    Number(position.margin);

  let multiplier =
    10 **
    (DECIMALS_PER_ASSET[position.synthetic_token] +
      PRICE_DECIMALS_PER_ASSET[position.synthetic_token] -
      COLLATERAL_TOKEN_DECIMALS);

  leverage = leverage / multiplier;

  return leverage <= maxLeverage;
}

function checkViableSizeAfterFlip(position, added_size, added_price) {
  let new_size =
    Number(added_size) -
    Number(position.position_size) /
      10 ** DECIMALS_PER_ASSET[position.synthetic_token];

  const maxLeverage = getMaxLeverage(
    Number(position.synthetic_token),
    new_size
  );

  let leverage =
    (new_size * added_price) /
    Number(position.margin / 10 ** COLLATERAL_TOKEN_DECIMALS);

  return leverage <= maxLeverage;
}

module.exports = {
  calulateLiqPriceInMarginChangeModal,
  calcAvgEntryInIncreaseSize,
  calulateLiqPriceInIncreaseSize,
  calulateLiqPriceInDecreaseSize,
  calulateLiqPriceInFlipSide,
  getCurrentLeverage,
  getMinViableMargin,
  checkViableSizeAfterFlip,
  checkViableSizeAfterIncrease,
  _getBankruptcyPrice,
  _getLiquidationPrice,
  getNewMaxLeverage,
  MAX_LEVERAGE,
  getSizeFromLeverage,
  getMaxLeverage,
};
