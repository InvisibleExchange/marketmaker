//

const {
  getActiveOrders,
  handleLiquidityUpdate,
  handleSwapResult,
  handlePerpSwapResult,
  fetchLiquidity,
  DECIMALS_PER_ASSET,
  CHAIN_IDS,
} = require("../src/helpers/utils");
const {
  sendSpotOrder,
  sendDeposit,
} = require("../src/transactions/constructOrders");
const User = require("../src/users/Invisibl3User");
const { trimHash } = require("../src/users/Notes");

//

//

//

//

// Generate a user and mint a large amount of funds with multiple deposits

// Every 10 seconds generate 3-5 random market/limit orders of various amounts

//

//

class Environemnt {
  constructor(user, baseAsset, quoteAsset) {
    this.user = user;
    this.baseAsset = baseAsset;
    this.quoteAsset = quoteAsset;
  }

  sendRandomOrder(user, side) {
    let spentToken = side == "Buy" ? this.quoteAsset : this.baseAsset;

    let availableBalance =
      user.getAvailableAmount(spentToken) /
      10 ** DECIMALS_PER_ASSET[spentToken];

    // ? get random amount between 0.10 and 0.20 of available balance
    let amountRatio = Math.random() * (0.2 - 0.1) + 0.1;
    let spentAmount = Number(availableBalance) * amountRatio;

    if (spentAmount == 0) return;

    let isMarket = true; // Math.random() > 0.15;

    let price;
    if (isMarket) {
      price = getMarketPrice(this.baseAsset);
    } else {
      let marketPrice = getMarketPrice(this.baseAsset);

      price =
        side == "Buy"
          ? marketPrice * (Math.random() * (1.05 - 0.75) + 0.75)
          : marketPrice * (Math.random() * (1.25 - 0.95) + 0.95);
    }

    console.log(
      "sending order",
      side,
      spentAmount.toFixed(2),
      price.toFixed(2),
      isMarket
    );

    sendSpotOrder(
      user,
      side,
      3_600_000,
      this.baseAsset,
      this.quoteAsset,
      spentAmount,
      spentAmount,
      price,
      0.07,
      null,
      3,
      isMarket,
      null
    );
  }

  async runEnvironment() {
    let liq_ = await fetchLiquidity(this.baseAsset, false);
    let liq = {};
    liq[this.baseAsset] = liq_;
    setLiquidity(liq);

    listenToWebSocket(this.user);

    setInterval(() => {
      // ? every 10 seconds 3-5 random users create random orders (limit/market) for amounts and prices within a random deviation of the current price

      let randCount = Math.floor(Math.random() * 3) + 3;

      console.log("sending ", randCount, " random orders");

      for (let i = 0; i < randCount; i++) {
        let randomSide = Math.random() > 0.5 ? "Buy" : "Sell";

        this.sendRandomOrder(this.user, randomSide);
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
  let { bidQueue, askQueue } = liquidity[token];

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

async function executeDeposits(user, baseAsset, quoteAsset) {
  let baseAmount = user.getAvailableAmount(baseAsset);
  let quoteAmount = user.getAvailableAmount(quoteAsset);

  // ? base deposits
  if (baseAmount < 0.05) {
    for (let i = 0; i < 3; i++) {
      let amount = 0.25;

      let depositId = CHAIN_IDS["ETH Mainnet"] * 2 ** 32 + 1111111111;
      await sendDeposit(user, depositId, amount, baseAsset, 123456789);
    }
  }

  // ? Qoute deposits
  if (quoteAmount < 1000) {
    for (let i = 0; i < 3; i++) {
      let amount = 7500;

      let depositId = CHAIN_IDS["Starknet"] * 2 ** 32 + 1111111111;
      await sendDeposit(user, depositId, amount, quoteAsset, 123456789);
    }
  }
}

// * ================================================================================================

let testPks = [
  197832656235823563829582375723952365712349238592307124122352355n,
  1237523869523685923982374237858237859235723893753275235235325253n,
  238956235723698534092357923562389523957235235352238752357923589n,
  2375623569823525723895327598235230895235790283343652352322352355n,
  23785982394723950872395723589326572385972385235786239852893586923n,
  829356238582375982365823579236523759292352352353252353253252350n,
  239852370523582376596235629359293527359023573285723952635236895n,
  9074238795623523695947913289562395972385235689235238952309238523n,
  9623856923572358923562357293738562378956238527385152783915712985n,
  1578962935501829562753941528019526579150235289562137509382561235n,
  2859692377893264157123803591237569123750235349051283523158925235n,
  2356917525235781924563487521735601347568023653479150235678235341n,
  728394563457893645791572305734856341902387562183573408512353543n,
];

async function main() {
  const idx = process.argv[2] ?? 0;
  let privKey = testPks[idx % 13];

  let baseAsset = 12345;
  let quoteAsset = 55555;

  console.log("starting test with pk: ", privKey.toString(16));
  let user = await initAccountState(privKey);

  console.log("user id: ", user.userId);

  await executeDeposits(user, baseAsset, quoteAsset);

  let env = new Environemnt(user, baseAsset, quoteAsset);

  await env.runEnvironment();
}

main();
