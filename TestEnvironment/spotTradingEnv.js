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
const UserState = require("../src/users/Invisibl3User");
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

  async sendRandomOrder(user, side, isMarket) {
    let spentToken = side == "Buy" ? this.quoteAsset : this.baseAsset;

    let availableBalance =
      user.getAvailableAmount(spentToken) /
      10 ** DECIMALS_PER_ASSET[spentToken];

    // ? get random amount between 0.05 and 0.20 of available balance
    let amountRatio = Math.random() * (0.2 - 0.05) + 0.05;
    let spentAmount = Number(availableBalance) * amountRatio;

    if (spentAmount == 0) return;

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
      3600,
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
    }, 30_000);

    //

    //
  }

  async executeOrders() {
    // ? every 10 seconds 3-5 random users create random orders (limit/market) for amounts and prices within a random deviation of the current price

    let randCount = Math.floor(Math.random() * 3) + 3;

    for (let i = 0; i < randCount; i++) {
      let randomSide = Math.random() > 0.5 ? "Buy" : "Sell";
      let isMarket = Math.random() > 0.35;

      await this.sendRandomOrder(this.user, randomSide, isMarket);
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
  let user_ = UserState.fromPrivKey(privKey.toString(16));

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
  if (availableBase > 0) {
    await sendSplitOrder(user_, baseAsset, availableBase).catch((e) => {
      console.log("error splitting notes", e);
    });
  }

  let availableQuote = user_.getAvailableAmount(quoteAsset);
  if (availableQuote > 0) {
    await sendSplitOrder(user_, quoteAsset, availableQuote).catch((e) => {
      console.log("error splitting notes", e);
    });
  }

  console.log(user_.noteData[baseAsset]?.length, "base notes");
  console.log(user_.noteData[quoteAsset]?.length, "quote notes");

  return user_;
};

// * ================================================================================================

async function executeDeposits(user, baseAsset, quoteAsset) {
  let baseAmount = user.getAvailableAmount(baseAsset);
  let quoteAmount = user.getAvailableAmount(quoteAsset);

  // ? base deposits
  if (baseAmount < 0.05) {
    for (let i = 0; i < 3; i++) {
      let amount = baseAsset == 12345 ? 0.55 : 7;

      let depositId = CHAIN_IDS["ETH Mainnet"] * 2 ** 32 + 1111111111;
      await sendDeposit(user, depositId, amount, baseAsset, 123456789);
    }
  }

  // ? Qoute deposits
  if (quoteAmount < 1000) {
    for (let i = 0; i < 3; i++) {
      let amount = 15000;

      let depositId = CHAIN_IDS["Starknet"] * 2 ** 32 + 1111111111;
      await sendDeposit(user, depositId, amount, quoteAsset, 123456789);
    }
  }
}

// * ================================================================================================

let testPks = [
  19783265623582356382958237572395236571233463463469230712412235235512n,
  12375238695236859239823785823785738295323572389375327523523532525312n,
  2389562357236985340923556238952738295395723523535223875235792358912n,
  23756235698235257238953223523089738295323579028334365235232235235512n,
  237859823947239508723957232657238738295397238523578623985289358692312n,
  8293562385823759823658223652375738295329235235235325235325325235012n,
  2398523705235823765962335929352738295335902357328572395263523689512n,
  90742387956235236959479156239597738295338523568923523895230923852312n,
  96238569235723589235623573856237738295395623852738515278391571298512n,
  15789629355018295627539401952657738295315023528956213750938256123512n,
  28596923778932641571238023756912738295375023534905128352315892523512n,
  23569175252357819245634873560134738295356802365347915023567823534112n,
  7283945634578936457915773485634738295390238756218357340851235354312n,
  2893500234782935670432678946347503278456437863498543768903246798346n,
  783458349562375946237589314572315609346578349563471859235347853468345n,
  8753495874563784561347895634758349570469137623053515394357813459431n,
  892352075562436890566340986347676483091590653249086312518349053486833n,
  748394840895134579834587456343468947315834980640189577348590345348346n,
  467889105348953468974359504378964358079415704357349867347893475435431n,
  578934687548709384589436178438068467537503496564375784391857348967346n,
  982352754870938458943617823557437503425235235656437578434434348967346n,
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
