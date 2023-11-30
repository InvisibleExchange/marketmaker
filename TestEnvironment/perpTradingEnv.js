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
} = require("invisible-sdk/src/utils");
const {
  sendDeposit,
  sendPerpOrder,
} = require("invisible-sdk/src/transactions");
const { UserState } = require("invisible-sdk/src/users");
const { trimHash } = require("../src/helpers");

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

    if (!position) return;

    let posSize =
      position.position_size / 10 ** DECIMALS_PER_ASSET[this.syntheticAsset];
    let margin = position.margin / 10 ** DECIMALS_PER_ASSET[COLLATERAL_TOKEN];

    let marketPrice = getMarketPrice(this.syntheticAsset);
    if (!marketPrice) return;
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

    console.log("sending", isMarket, "order");

    await sendPerpOrder(
      this.user,
      side,
      3600,
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

    let count = 1;
    await this.executeOrders();
    setInterval(async () => {
      if (count == 2) {
        count = 0;

        let position = this.user.positionData[this.syntheticAsset][0];

        if (!position) return;

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
          this.user.positionData[this.syntheticAsset].length > 0 &&
          this.user.positionData[this.syntheticAsset][0].hash ==
            prevPositionHash
        ) {
          this.user.positionData[this.syntheticAsset].splice(0, 1);
        }
      } else {
        await this.executeOrders();
        count++;
      }
    }, 30_000);

    //
  }

  async executeOrders() {
    // ? every 10 seconds 3-5 random users create random orders (limit/market) for amounts and prices within a random deviation of the current price
    let randCount = Math.floor(Math.random() * 3) + 3;

    for (let i = 0; i < randCount; i++) {
      let randomSide = Math.random() > 0.5 ? "Long" : "Short";

      await this.sendRandomOrder(randomSide);
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
  if (!perpLiquidity[token]) return;
  let { bidQueue, askQueue } = perpLiquidity[token];

  let topBidPrice = bidQueue[0]?.price ?? 0;
  let topAskPrice = askQueue[askQueue.length - 1]?.price ?? 0;

  return (topBidPrice + topAskPrice) / 2;
}

let W3CWebSocket = require("websocket").w3cwebsocket;
let client;
const listenToWebSocket = (user) => {
  const SERVER_URL = "localhost";
  // const SERVER_URL = "54.212.28.196";

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
      3600,
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
  7283572352352735862389523897503275946275745756375547457696774575475474n,
  123752353523523523523523512358582378592338292235263463275235235325253n,
  23895623572369853409235792356232351235235235465473829823526346357923589n,
  2375623569823497796799653867475612363271502832138291235263462352322352355n,
  2378598239472395087239257658512361346458356838296235263466239852893586923n,
  8293562385812375982365823538292235263465929223465685675456252353253252350n,
  23985237052358237659625734545712374575475474538297235263463952635236895n,
  907423879562352369591231347638980783829423526346678035689235238952309238523n,
  9623856923572358923562379412374635478796338294235263467385152783915712985n,
  46980579679578056961238058705280193829623526346235289562137509382561235n,
  285961233778932641573829323526346237569578078507804832345378499087087087935n,
  235691235252357819243829123526346173560133829523526346809876096795707805078n,
  72123482375023572382992352634691572305734856341902387562183573408512353543n,
  28935265923406834798695801723051239347824534633829623526346346573498672346n,
  4587345692348758732512312305715236538293235263465779345809213571230753495n,
  8945014123098436893740382992352634636943601379857104647368437134789063416n,
];

async function main() {
  const startIdx = process.argv[2] ?? 0;

  let baseAssets = [12345, 54321];

  let nUsers = 2;

  for (let i = 0; i < nUsers; i++) {
    let privKey = testPks[(startIdx + i) % 13];

    let user = await initAccountState(privKey);

    listenToWebSocket(user);

    for (let i = 0; i < baseAssets.length; i++) {
      const baseAsset = baseAssets[i];

      await openPosition(user, baseAsset);

      let env = new Environemnt(user, baseAsset, 3.0);

      env.runEnvironment();
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 800_000_000));
}

main();
