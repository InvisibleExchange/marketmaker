const {
  SPOT_MARKET_IDS,
  SYMBOLS_TO_IDS,
  COLLATERAL_TOKEN,
} = require("invisible-sdk/src/utils");
const {
  sendSpotOrder,
  sendPerpOrder,
  sendCancelOrder,
  sendAmendOrder,
} = require("invisible-sdk/src/transactions");
const UserState = require("invisible-sdk/src/users");

async function spotOrder() {
  let privKey = "0x1234";
  let marketMaker = await UserState.loginUser(privKey);

  /// Send a spot Limit Order
  let assetId = SYMBOLS_TO_IDS["ETH"];
  let side = "Buy";
  let expirationTime = 3600_000; // in seconds
  let baseToken = assetId;
  let quoteToken = COLLATERAL_TOKEN;
  let baseAmount = null; // Used for sell order
  let quoteAmount = 100; // User for buy order
  let price = 1950.0;
  let feeLimit = 0.1;
  let tabAddress = null;
  let slippage = 0.01;
  let isMarket = false;
  let ACTIVE_ORDERS = null;

  let response = await sendSpotOrder(
    marketMaker,
    side,
    expirationTime,
    baseToken,
    quoteToken,
    baseAmount,
    quoteAmount,
    price,
    feeLimit,
    tabAddress,
    slippage,
    isMarket,
    ACTIVE_ORDERS
  );
}

async function perpOrder() {
  let privKey = "0x1234";
  let marketMaker = await UserState.loginUser(privKey);

  /// Send a spot Limit Order
  let side = "Long";
  let expirationTime = 3600_000; // in seconds
  let positionEffectType = "Open"; // "Open"/"Modify"/"Close"
  let positionAddress = null; // Used for modify/close orders
  let syntheticToken = SYMBOLS_TO_IDS["BTC"];
  let syntheticAmount = 0.1; // Used for sell order
  let price = 37359.1;
  let intialMargin = 2500.0;
  let feeLimit = 0.1;
  let slippage = 0.01;
  let isMarket = false;
  let ACTIVE_ORDERS = null;

  let response = await sendPerpOrder(
    marketMaker,
    side,
    expirationTime,
    positionEffectType,
    positionAddress,
    syntheticToken,
    syntheticAmount,
    price,
    intialMargin,
    feeLimit,
    slippage,
    isMarket,
    ACTIVE_ORDERS
  );
}

async function updates() {
  let privKey = "0x1234";
  let marketMaker = await UserState.loginUser(privKey);

  /// Send a Cancel Order
  let orderId = 123;
  let isBid = true; // true for bid, false for ask
  let isPerp = true;
  let assetId = SYMBOLS_TO_IDS["ETH"];
  let marketId = SPOT_MARKET_IDS[assetId];
  let res = await sendCancelOrder(
    marketMaker,
    orderId,
    isBid,
    isPerp,
    marketId
  );

  /// Send an Amend Order
  let newPrice = 1950.0;
  let newExpirationTime = 3600_000; // in seconds
  let tabAddress = null;
  let match_only = false; // This will only match the orders within the new price range without updating them
  let ACTIVE_ORDERS = null;
  res = await sendAmendOrder(
    marketMaker,
    orderId,
    isBid,
    isPerp,
    marketId,
    newPrice,
    newExpirationTime,
    tabAddress,
    match_only,
    ACTIVE_ORDERS
  );
}

// sendSpotOrder,
// sendPerpOrder,
// sendCancelOrder,
// sendDeposit,
// sendWithdrawal,
// sendAmendOrder,
// sendSplitOrder,
// sendChangeMargin,
// sendLiquidationOrder,
// sendOpenOrderTab,
// sendCloseOrderTab,
// sendModifyOrderTab,
// sendRegisterMm,
// sendAddLiquidityUser,
// sendOnChainAddLiquidityMM,
// sendOnChainRemoveLiquidityUser,
// sendOnChainRemoveLiquidityMM,
