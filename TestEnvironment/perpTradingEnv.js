//

const {
  getActiveOrders,
  handleLiquidityUpdate,
  handleSwapResult,
  handlePerpSwapResult,
  fetchLiquidity,
  DECIMALS_PER_ASSET,
  CHAIN_IDS,
  COLLATERAL_TOKEN,
} = require("../src/helpers/utils");
const {
  sendDeposit,
  sendPerpOrder,
} = require("../src/transactions/constructOrders");
const User = require("../src/users/Invisibl3User");
const { trimHash } = require("../src/transactions/stateStructs/Notes");

//

//

//

//

// Generate a user and mint a large amount of funds with multiple deposits

// Every 10 seconds generate 3-5 random market/limit orders of various amounts

//

//

class Environemnt {
  constructor(user, syntheticAsset, maxLeverage) {
    this.user = user;
    this.syntheticAsset = syntheticAsset;
    this.maxLeverage = maxLeverage;
  }

  async sendRandomOrder(side) {
    let position = this.user.positionData[this.syntheticAsset][0];

    let posSize =
      position.position_size / 10 ** DECIMALS_PER_ASSET[this.syntheticAsset];
    let margin = position.margin / 10 ** DECIMALS_PER_ASSET[COLLATERAL_TOKEN];

    let marketPrice = getMarketPrice(this.syntheticAsset);
    let maxSize = (this.maxLeverage * margin) / marketPrice;

    let maxBuySize =
      position.order_side == "Long" ? maxSize - posSize : maxSize + posSize;
    let maxSellSize =
      position.order_side == "Short" ? maxSize - posSize : maxSize + posSize;

    // ? get random amount between 0.05 and 0.20 of available balance
    let amountRatio = Math.random() * (0.2 - 0.05) + 0.05;

    let tradeAmount =
      position.order_side == "Long"
        ? Number(maxBuySize) * amountRatio
        : Number(maxSellSize) * amountRatio;

    if (tradeAmount == 0) return;

    let isMarket = Math.random() > 0.3;

    let price;
    if (isMarket) {
      price = marketPrice;
    } else {
      price =
        side == "Buy"
          ? marketPrice * (Math.random() * (1.02 - 0.9) + 0.9)
          : marketPrice * (Math.random() * (1.1 - 0.98) + 0.98);
    }

    // console.log(
    //   "sending perp order",
    //   side,
    //   tradeAmount.toFixed(2),
    //   price.toFixed(2),
    //   isMarket
    // );

    await sendPerpOrder(
      this.user,
      side,
      300,
      "Modify",
      position.position_header.position_address,
      this.syntheticAsset,
      tradeAmount,
      price,
      null,
      0.07,
      3,
      isMarket,
      null
    ).catch((e) => {
      console.log("error sending order", e);
    });
  }

  async runEnvironment() {
    let liq_ = await fetchLiquidity(this.syntheticAsset, true);
    let liq = {};
    liq[this.syntheticAsset] = liq_;
    setPerpLiquidity(liq);

    listenToWebSocket(this.user);

    let count = 0;
    setInterval(async () => {
      if (count == 10) {
        count = 0;

        let position = this.user.positionData[this.syntheticAsset][0];
        let side = position.order_side == "Long" ? "Short" : "Long";

        let prevPositionHash = position.hash;

        // ? Close position
        await sendPerpOrder(
          this.user,
          side,
          300,
          "Close",
          position.position_header.position_address,
          this.syntheticAsset,
          position.position_size /
            10 ** DECIMALS_PER_ASSET[this.syntheticAsset],
          getMarketPrice(this.syntheticAsset),
          null,
          0.07,
          3,
          true,
          null
        ).catch((e) => {
          console.log("error sending order", e);
        });

        // ? Open new Position
        await sendPerpOrder(
          this.user,
          side,
          300,
          "Open",
          null,
          this.syntheticAsset,
          position.position_size /
            10 ** DECIMALS_PER_ASSET[this.syntheticAsset],
          getMarketPrice(this.syntheticAsset),
          this.user.getAvailableAmount(COLLATERAL_TOKEN) /
            10 ** DECIMALS_PER_ASSET[COLLATERAL_TOKEN],
          0.07,
          3,
          true,
          null
        ).catch((e) => {
          console.log("error sending order", e);
        });

        if (
          this.user.positionData[this.syntheticAsset][0].hash ==
          prevPositionHash
        ) {
          this.user.positionData[this.syntheticAsset].splice(idx, 1);
        }
      } else {
        // ? every 10 seconds 3-5 random users create random orders (limit/market) for amounts and prices within a random deviation of the current price
        let randCount = Math.floor(Math.random() * 3) + 3;

        for (let i = 0; i < randCount; i++) {
          let randomSide = Math.random() > 0.5 ? "Long" : "Short";

          await this.sendRandomOrder(randomSide);
        }

        count++;
      }
    }, 10_000);

    //

    //
  }
}

// * ================================================================================================
const CONFIG_CODE = "1234567890";

let liquidity = {};
const setLiquidity = (liq) => {
  liquidity = liq;
};
let perpLiquidity = {};
const setPerpLiquidity = (liq) => {
  perpLiquidity = liq;
};

function getMarketPrice(token) {
  let { bidQueue, askQueue } = perpLiquidity[token];

  let topBidPrice = bidQueue[0]?.price ?? 0;
  let topAskPrice = askQueue[askQueue.length - 1]?.price ?? 0;

  return (topBidPrice + topAskPrice) / 2;
}

let W3CWebSocket = require("websocket").w3cwebsocket;
let client;
const listenToWebSocket = (user) => {
  let SERVER_URL = "localhost";
  client = new W3CWebSocket(`ws://${SERVER_URL}:50053`);

  client.onopen = function () {
    const ID = trimHash(user.userId, 64);
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

      case "SWAP_RESULT":
        handleSwapResult(
          user,
          msg.order_id,
          msg.spent_amount,
          msg.received_amount,
          msg.swap_response.note_info_swap_response,
          msg.market_id,
          null
        );

        console.log(
          "SWAP sucessful: ",
          msg.spent_amount,
          " - ",
          msg.received_amount
        );

        break;

      case "PERPETUAL_SWAP":
        handlePerpSwapResult(user, msg.order_id, msg.swap_response);

        console.log("PERP SWAP sucessful: ", msg.swap_response.qty);

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

// * ================================================================================================

const initAccountState = async (privKey) => {
  let user_ = User.fromPrivKey(privKey.toString(16));

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

  return user_;
};

// * ================================================================================================

async function openPosition(user, syntheticAsset) {
  let positionData = user.positionData[syntheticAsset];

  if (!positionData || positionData.length == 0) {
    let amount = 8000;

    let depositId = CHAIN_IDS["Starknet"] * 2 ** 32 + 222222222;
    await sendDeposit(user, depositId, amount, COLLATERAL_TOKEN, 123456789);

    let dummyPrice = 25_000;

    // ? open position
    await sendPerpOrder(
      user,
      "Long",
      10,
      "Open",
      null,
      syntheticAsset,
      0.001,
      dummyPrice,
      amount,
      0.07,
      99,
      true,
      null
    ).catch((e) => {
      console.log("error sending order", e);
    });
  }
}

// * ================================================================================================

let testPks = [
  1978326562358235638295823757239235352523523532523523523523522352355n,
  1237523535235235235235235235858237859235723893753275235235325253n,
  238956235723698534092357923562323523523523546547458768457357923589n,
  23756235698234977967996538674756346327150283211111243652352322352355n,
  23785982394723950872392576585326134645835683565235786239852893586923n,
  82935623858237598236582357923652375929223465685675456252353253252350n,
  239852370523582376596257345457457457547547457573285723952635236895n,
  9074238795623523695947134763898078054976587678035689235238952309238523n,
  96238569235723589235623794357463547879637546547527385152783915712985n,
  469805796795780569659805870528019526579150235289562137509382561235n,
  2859692377893264157123803591237569578078507804832345378499087087087935n,
  235691752523578192456348752173560134756802578098760967957807607805078n,
  722948237502357238952355791572305734856341902387562183573408512353543n,
];

async function main() {
  const idx = process.argv[2] ?? 1;
  let privKey = testPks[idx % 13];

  let baseAsset = 12345;

  let user = await initAccountState(privKey);

  console.log("user initialized: ", user.positionData[baseAsset]);

  await openPosition(user, baseAsset);

  let env = new Environemnt(user, baseAsset, 3.0);

  await env.runEnvironment();
}

main();
