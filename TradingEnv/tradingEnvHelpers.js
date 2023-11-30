// * ---------------------------------------------------

const {
  PERP_MARKET_IDS_2_TOKENS,
  handleLiquidityUpdate,
  handlePerpSwapResult,
} = require("invisible-sdk/src/utils");
const { sendCancelOrder } = require("invisible-sdk/src/transactions");
const { trimHash } = require("invisible-sdk/src/transactions");

let W3CWebSocket = require("websocket").w3cwebsocket;

function _listenToWebSocket(
  CONFIG_CODE,
  SERVER_URL,
  RELAY_WS_URL,
  marketmaker,
  liquidity,
  setLiquidity,
  perpLiquidity,
  setPerpLiquidity,
  ACTIVE_ORDERS
) {
  let client;

  if (CONFIG_CODE && CONFIG_CODE != 0) {
    client = new W3CWebSocket(`ws://${SERVER_URL}:50053`);

    client.onopen = function () {
      const ID = trimHash(marketmaker.userId, 64);
      client.send(
        JSON.stringify({
          user_id: ID.toString(),
          config_code: CONFIG_CODE,
        })
      );
      console.log("WebSocket Client Connected");
    };
  } else {
    client = new W3CWebSocket(RELAY_WS_URL);

    client.onopen = function () {
      console.log("WebSocket Client Connected");
    };
  }

  client.onmessage = function (e) {
    let msg = JSON.parse(e.data);

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

      case "PERPETUAL_SWAP":
        handlePerpSwapResult(
          marketmaker,
          msg.order_id,
          msg.swap_response,
          msg.marketId,
          ACTIVE_ORDERS
        );

        // todo:   afterFill(msg.qty, msg.marketId);

        break;

      default:
        break;
    }
  };
}

// * ---------------------------------------------------

async function _cancelLiquidity(marketId, marketmaker, isPerp) {
  if (isPerp) {
    let syntheticAsset = PERP_MARKET_IDS_2_TOKENS[marketId];

    let promises = marketmaker.perpetualOrders
      .filter((ord) => ord.synthetic_token == syntheticAsset)
      .map((order) => {
        return sendCancelOrder(
          marketmaker,
          order.order_id,
          order.order_side,
          true,
          marketId,
          0
        );
      });

    await Promise.all(promises);
  }
}

// * ---------------------------------------------------

function _getMarkPrice(token, liquidity) {
  if (!liquidity[token]) return null;

  let { bidQueue, askQueue } = liquidity[token];

  let topBidPrice = bidQueue[0]?.price;
  let topAskPrice = askQueue[askQueue.length - 1]?.price ?? 0;

  if (!topBidPrice || !topAskPrice) return null;

  let markPrice = (topBidPrice + topAskPrice) / 2;

  return Number(markPrice);
}

// * ---------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithTimeout(asyncFn, timeout) {
  const timeoutPromise = delay(timeout).then(() => {
    throw new Error("Timeout");
  });

  await Promise.race([asyncFn(), timeoutPromise]);
}

module.exports = {
  _listenToWebSocket,
  _cancelLiquidity,
  _getMarkPrice,
  delay,
  runWithTimeout,
};
