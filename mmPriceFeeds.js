const WebSocket = require("ws");
const ethers = require("ethers");
const fetch = require("node-fetch");
const fs = require("fs");
const { default: axios } = require("axios");
const { setInterval } = require("timers/promises");

async function setupPriceFeeds(MM_CONFIG, PRICE_FEEDS) {
  const cryptowatch = [],
    cryptowatch2 = [];
  for (let market in MM_CONFIG.pairs) {
    const pairConfig = MM_CONFIG.pairs[market];
    if (!pairConfig.active) {
      continue;
    }

    if (pairConfig.mode == "constant") {
      const initPrice = pairConfig.initPrice;
      pairConfig["priceFeedPrimary"] = "constant:" + initPrice.toString();
    }
    const primaryPriceFeed = pairConfig.priceFeedPrimary;
    const secondaryPriceFeed = pairConfig.priceFeedSecondary;

    // parse keys to lower case to match later PRICE_FEED keys
    if (primaryPriceFeed) {
      MM_CONFIG.pairs[market].priceFeedPrimary = primaryPriceFeed.toLowerCase();
    }
    if (secondaryPriceFeed) {
      MM_CONFIG.pairs[market].priceFeedSecondary =
        secondaryPriceFeed.toLowerCase();
    }
    [primaryPriceFeed, secondaryPriceFeed].forEach((priceFeed) => {
      if (!priceFeed) {
        return;
      }
      const [provider, id] = priceFeed.split(":");
      switch (provider.toLowerCase()) {
        case "cryptowatch":
          if (!cryptowatch.includes(id)) {
            cryptowatch.push(id);
          }
          break;
        case "cryptowatch2":
          if (!cryptowatch2.includes(id)) {
            cryptowatch2.push(id);
          }

          break;
        case "constant":
          PRICE_FEEDS["constant:" + id] = parseFloat(id);
          break;
        default:
          throw new Error(
            "Price feed provider " + provider + " is not available."
          );
      }
    });
  }
  // if (chainlink.length > 0) await chainlinkSetup(chainlink, PRICE_FEEDS);
  // if (uniswapV3.length > 0) await uniswapV3Setup(uniswapV3, PRICE_FEEDS);

  try {
    if (cryptowatch.length > 0) {
      await cryptowatchWsSetup(cryptowatch, PRICE_FEEDS, MM_CONFIG);
    }

    if (cryptowatch2.length > 0) {
      await cryptowatch2WsSetup(cryptowatch2, PRICE_FEEDS, MM_CONFIG);
    }
  } catch (error) {
    console.log("error: ", error);
  }
}

let cryptowatch_ws;
async function cryptowatchWsSetup(
  cryptowatchMarketIds,
  PRICE_FEEDS,
  MM_CONFIG
) {
  if (cryptowatch_ws) {
    cryptowatch_ws.close();
    cryptowatch_ws = null;

    return;
  }

  // Set initial prices
  const cryptowatchApiKey =
    process.env.CRYPTOWATCH_API_KEY || MM_CONFIG
      ? MM_CONFIG.cryptowatchApiKey
      : "";

  let cryptowatchMarkets = [];
  let cryptowatchMarketPrices = [];
  try {
    cryptowatchMarkets = await fetch(
      "https://api.cryptowat.ch/markets?apikey=" + cryptowatchApiKey
    )
      .then((r) => r.json())
      .catch((e) => {
        console.log("error setting price feeds:", e);
      });

    cryptowatchMarketPrices = await fetch(
      "https://api.cryptowat.ch/markets/prices?apikey=" + cryptowatchApiKey
    )
      .then((r) => r.json())
      .catch((e) => {
        console.log("error setting price feeds:", e);
      });
  } catch (error) {
    console.error("Could not fetch cryptowatch markets");
  }

  for (let i in cryptowatchMarketIds) {
    const cryptowatchMarketId = cryptowatchMarketIds[i];

    try {
      const cryptowatchMarket = cryptowatchMarkets.result.find(
        (row) => row.id == cryptowatchMarketId
      );

      const exchange = cryptowatchMarket.exchange;
      const pair = cryptowatchMarket.pair;
      const key = `market:${exchange}:${pair}`;

      PRICE_FEEDS["cryptowatch:" + cryptowatchMarketId] =
        cryptowatchMarketPrices.result[key];
    } catch (e) {
      console.log(e);
      console.log("cryptowatchMarketIds", cryptowatchMarketIds);
      console.error(
        "Could not set price feed for cryptowatch:" + cryptowatchMarketId
      );
    }
  }

  const subscriptionMsg = {
    subscribe: {
      subscriptions: [],
    },
  };
  for (let i in cryptowatchMarketIds) {
    const cryptowatchMarketId = cryptowatchMarketIds[i];

    // first get initial price info

    subscriptionMsg.subscribe.subscriptions.push({
      streamSubscription: {
        resource: `markets:${cryptowatchMarketId}:book:spread`,
      },
    });
  }

  cryptowatch_ws = new WebSocket(
    "wss://stream.cryptowat.ch/connect?apikey=" + cryptowatchApiKey
  );

  cryptowatch_ws.on("open", onopen);
  cryptowatch_ws.on("message", onmessage);
  cryptowatch_ws.on("close", onclose);
  cryptowatch_ws.on("error", (err) => {
    console.log("cryptowatch ws error", err);
    cryptowatch_ws.close();
  });

  function onopen() {
    cryptowatch_ws.send(JSON.stringify(subscriptionMsg));
  }

  function onmessage(data) {
    const msg = JSON.parse(data);
    if (!msg.marketUpdate) return;

    const marketId = "cryptowatch:" + msg.marketUpdate.market.marketId;
    let ask = msg.marketUpdate.orderBookSpreadUpdate.ask.priceStr;
    let bid = msg.marketUpdate.orderBookSpreadUpdate.bid.priceStr;
    let price = ask / 2 + bid / 2;
    PRICE_FEEDS[marketId] = price;
  }
  function onclose() {
    setTimeout(() => {
      cryptowatchWsSetup(cryptowatchMarketIds, PRICE_FEEDS, MM_CONFIG);
    }, 1000);
  }
}

let priceInterval;
async function cryptowatch2WsSetup(
  cryptowatchMarketIds,
  PRICE_FEEDS,
  MM_CONFIG
) {
  if (priceInterval) {
    clearInterval(priceInterval);

    return;
  }

  console.log("here");

  // Set initial prices
  const cryptowatchApiKey =
    process.env.CRYPTOWATCH_API_KEY || MM_CONFIG
      ? MM_CONFIG.cryptowatchApiKey
      : "";

  // ? start price update interval
  await _fetchPrice(cryptowatchMarketIds, PRICE_FEEDS, cryptowatchApiKey);
  priceInterval = setInterval(
    async () =>
      _fetchPrice(cryptowatchMarketIds, PRICE_FEEDS, cryptowatchApiKey),
    1000
  );
}

async function _fetchPrice(
  cryptowatchMarketIds,
  PRICE_FEEDS,
  cryptowatchApiKey
) {
  for (let id of cryptowatchMarketIds) {
    let [exchange, pair] = id.split("-");

    let summary;
    try {
      summary = await axios
        .get(
          `https://api.cryptowat.ch/markets/${exchange}/${pair}/summary?apikey=` +
            cryptowatchApiKey
        )
        .then((r) => r.data.result)
        .catch((e) => console.log(e));
    } catch (error) {
      console.error("Could not fetch cryptowatch markets", error);
    }

    if (!summary) {
      return;
    }

    // let [base, _] = config.symbol.split("/");

    const marketId = "cryptowatch2:" + id;

    console.log("summary", summary.price.last);

    PRICE_FEEDS[marketId] = summary.price.last;
  }
}

module.exports = {
  setupPriceFeeds,
};
