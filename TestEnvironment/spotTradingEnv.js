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
  sendSpotOrder,
  sendDeposit,
  sendSplitOrder,
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
  constructor(user, baseAsset, quoteAsset) {
    this.user = user;
    this.baseAsset = baseAsset;
    this.quoteAsset = quoteAsset;
  }

  async sendRandomOrder(user, side) {
    let spentToken = side == "Buy" ? this.quoteAsset : this.baseAsset;

    let availableBalance =
      user.getAvailableAmount(spentToken) /
      10 ** DECIMALS_PER_ASSET[spentToken];

    // ? get random amount between 0.05 and 0.20 of available balance
    let amountRatio = Math.random() * (0.2 - 0.05) + 0.05;
    let spentAmount = Number(availableBalance) * amountRatio;

    if (spentAmount == 0) return;

    let isMarket = Math.random() > 0.3;

    let price;
    if (isMarket) {
      price = getMarketPrice(this.baseAsset);
      if (!price) return;
    } else {
      let marketPrice = getMarketPrice(this.baseAsset);
      if (!price) return;

      price =
        side == "Buy"
          ? marketPrice * (Math.random() * (1.05 - 0.75) + 0.75)
          : marketPrice * (Math.random() * (1.25 - 0.95) + 0.95);
    }

    let tokenSpent = side == "Sell" ? this.baseAsset : this.quoteAsset;
    await sendSplitOrder(user, tokenSpent, spentAmount).catch((e) => {
      console.log("error splitting notes", e);
    });

    console.log("sending", isMarket, "order");
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
    ).catch((e) => {
      console.log("error sending order", e);
    });
  }

  async runEnvironment() {
    let liq_ = await fetchLiquidity(this.baseAsset, false);
    let liq = {};
    liq[this.baseAsset] = liq_;
    setLiquidity(liq);

    let count = 1;

    await this.executeOrders();
    setInterval(async () => {
      if (count == 10) {
        count = 0;
        let availableBase = this.user.getAvailableAmount(this.baseAsset);
        let availableQuote = this.user.getAvailableAmount(this.quoteAsset);

        sendSplitOrder(this.user, this.baseAsset, availableBase).catch((e) => {
          console.log("error splitting notes", e);
        });

        sendSplitOrder(this.user, this.quoteAsset, availableQuote).catch(
          (e) => {
            console.log("error splitting notes", e);
          }
        );
      } else {
        await this.executeOrders();
        count++;
      }
    }, 120_000);

    //

    //
  }

  async executeOrders() {
    // ? every 10 seconds 3-5 random users create random orders (limit/market) for amounts and prices within a random deviation of the current price

    let randCount = Math.floor(Math.random() * 3) + 3;

    for (let i = 0; i < randCount; i++) {
      let randomSide = Math.random() > 0.5 ? "Buy" : "Sell";

      await this.sendRandomOrder(this.user, randomSide);
    }
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
  if (!liquidity[token]) return;
  let { bidQueue, askQueue } = liquidity[token];

  let topBidPrice = bidQueue[0]?.price ?? 0;
  let topAskPrice = askQueue[askQueue.length - 1]?.price ?? 0;

  return (topBidPrice + topAskPrice) / 2;
}

let W3CWebSocket = require("websocket").w3cwebsocket;
let client;
const listenToWebSocket = (user) => {
  let SERVER_URL = "localhost";
  // let SERVER_URL = "54.212.28.196";

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
      listenToWebSocket(user);
    }, 5000);
  };
};

// * ================================================================================================

const initAccountState = async (privKey, baseAsset, quoteAsset) => {
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

  let availableBase = user_.getAvailableAmount(baseAsset);
  await sendSplitOrder(user_, baseAsset, availableBase).catch((e) => {
    console.log("error splitting notes", e);
  });

  let availableQuote = user_.getAvailableAmount(quoteAsset);
  await sendSplitOrder(user_, quoteAsset, availableQuote).catch((e) => {
    console.log("error splitting notes", e);
  });

  return user_;
};

// * ================================================================================================

async function executeDeposits(user, baseAsset, quoteAsset) {
  let baseAmount = user.getAvailableAmount(baseAsset);
  let quoteAmount = user.getAvailableAmount(quoteAsset);

  // ? base deposits
  if (baseAmount < 0.05) {
    for (let i = 0; i < 3; i++) {
      let amount = 0.3;

      let depositId = CHAIN_IDS["ETH Mainnet"] * 2 ** 32 + 1111111111;
      await sendDeposit(user, depositId, amount, baseAsset, 123456789);
    }
  }

  // ? Qoute deposits
  if (quoteAmount < 1000) {
    for (let i = 0; i < 3; i++) {
      let amount = 8000;

      let depositId = CHAIN_IDS["Starknet"] * 2 ** 32 + 1111111111;
      await sendDeposit(user, depositId, amount, quoteAsset, 123456789);
    }
  }
}

// * ================================================================================================

let testPks = [
  19783265623582356382958237572395236571234923859230712412235235512n,
  123752386952368592398237423785823785923572389375327523523532525312n,
  23895623572369853409235792356238952395723523535223875235792358912n,
  237562356982352572389532759823523089523579028334365235232235235512n,
  2378598239472395087239572358932657238597238523578623985289358692312n,
  82935623858237598236582357923652375929235235235325235325325235012n,
  23985237052358237659623562935929352735902357328572395263523689512n,
  907423879562352369594791328956239597238523568923523895230923852312n,
  962385692357235892356235729373856237895623852738515278391571298512n,
  157896293550182956275394152801952657915023528956213750938256123512n,
  285969237789326415712380359123756912375023534905128352315892523512n,
  235691752523578192456348752173560134756802365347915023567823534112n,
  72839456345789364579157230573485634190238756218357340851235354312n,
];

async function main() {
  const startIdx = process.argv[2] ?? 0;

  let baseAssets = [12345, 54321];

  let nUsers = 1;

  for (let i = 0; i < nUsers; i++) {
    let privKey = testPks[(startIdx + i) % 13];

    let user = await initAccountState(privKey);

    listenToWebSocket(user);

    for (let i = 0; i < baseAssets.length; i++) {
      const baseAsset = baseAssets[i];

      await executeDeposits(user, baseAsset, COLLATERAL_TOKEN);

      let env = new Environemnt(user, baseAsset, COLLATERAL_TOKEN);

      env.runEnvironment();
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 800_000_000));
}

main();
