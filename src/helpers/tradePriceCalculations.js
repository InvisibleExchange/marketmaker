const {
  DECIMALS_PER_ASSET,
  PRICE_DECIMALS_PER_ASSET,
  COLLATERAL_TOKEN_DECIMALS,
  get_max_leverage,
} = require("./utils");

// calculate prices

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

function _getLiquidationPrice(entryPrice, bankruptcyPrice, orderSide) {
  if (bankruptcyPrice == 0) {
    return 0;
  }

  // maintnance margin
  let mm_rate = 3; // 3% of 100

  // liquidation price is 2% above/below the bankruptcy price
  if (orderSide == "Long" || orderSide == 0) {
    return (
      Number(bankruptcyPrice) + Math.floor((mm_rate * Number(entryPrice)) / 100)
    );
  } else {
    return (
      Number(bankruptcyPrice) - Math.floor((mm_rate * Number(entryPrice)) / 100)
    );
  }
}

function calulateLiqPriceInMarginChangeModal(position, marginChange) {
  marginChange = marginChange * 10 ** COLLATERAL_TOKEN_DECIMALS;

  let bankruptcyPrice = _getBankruptcyPrice(
    Number(position.entry_price),
    Number(position.margin) + marginChange,
    Number(position.position_size),
    position.order_side,
    position.synthetic_token
  );

  let liqPrice = _getLiquidationPrice(
    Number(position.entry_price),
    bankruptcyPrice,
    position.order_side
  );

  return Math.max(liqPrice, 0);
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

// Calculate liquidation prices

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

  let bankruptcyPrice = _getBankruptcyPrice(
    avgEntryPrice,
    Number(position.margin),
    Number(position.position_size) + scaledSize,
    position.order_side,
    position.synthetic_token
  );

  let liqPrice = _getLiquidationPrice(
    avgEntryPrice,
    bankruptcyPrice,
    position.order_side
  );

  return Math.max(liqPrice, 0);
}

function calulateLiqPriceInDecreaseSize(position, sizeChange) {
  let scaledSize =
    Number(sizeChange) * 10 ** DECIMALS_PER_ASSET[position.synthetic_token];

  let new_size = Number(position.position_size) - scaledSize;

  let bankruptcyPrice = _getBankruptcyPrice(
    Number(position.entry_price),
    Number(position.margin),
    new_size,
    position.order_side,
    position.synthetic_token
  );

  let liqPrice = _getLiquidationPrice(
    Number(position.entry_price),
    bankruptcyPrice,
    position.order_side
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

  let bankruptcyPrice = _getBankruptcyPrice(
    scaledPrice,
    Number(position.margin),
    new_size,
    newOrderSide,
    position.synthetic_token
  );

  let liqPrice = _getLiquidationPrice(
    scaledPrice,
    bankruptcyPrice,
    newOrderSide
  );

  return Math.max(liqPrice, 0);
}

//  Calculate leverage and min viable margin

function getCurrentLeverage(indexPrice, size, margin) {
  if (indexPrice == 0) {
    return 0;
  }

  const currentLeverage = (Number(indexPrice) * Number(size)) / Number(margin);

  return currentLeverage;
}

function getMinViableMargin(position) {
  const maxLeverage = get_max_leverage(
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

// Check vaible sizes

function checkViableSizeAfterIncrease(position, added_size, added_price) {
  let new_size =
    Number(position.position_size) /
      10 ** DECIMALS_PER_ASSET[position.synthetic_token] +
    Number(added_size);

  const maxLeverage = get_max_leverage(position.synthetic_token, new_size);

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

  const maxLeverage = get_max_leverage(
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
};
