const WebSocket = require("ws");
const ethers = require("ethers");
const fetch = require("node-fetch");
const fs = require("fs");

const CHAINLINK_PROVIDERS = {};
const UNISWAP_V3_PROVIDERS = {};

let uniswap_error_counter = 0;
let chainlink_error_counter = 0;

module.exports = async function setupPriceFeeds(MM_CONFIG, PRICE_FEEDS) {
  const cryptowatch = [],
    chainlink = [],
    uniswapV3 = [];
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
        case "chainlink":
          if (!chainlink.includes(id)) {
            chainlink.push(id);
          }
          break;
        case "uniswapv3":
          if (!uniswapV3.includes(id)) {
            uniswapV3.push(id);
          }
          break;
        case "constant":
          PRICE_FEEDS["constant:" + id] = parseFloat(id);
          break;
        default:
          throw new Error(
            "Price feed provider " + provider + " is not available."
          );
          break;
      }
    });
  }
  if (chainlink.length > 0) await chainlinkSetup(chainlink, PRICE_FEEDS);
  if (cryptowatch.length > 0)
    await cryptowatchWsSetup(cryptowatch, PRICE_FEEDS, MM_CONFIG);
  if (uniswapV3.length > 0) await uniswapV3Setup(uniswapV3, PRICE_FEEDS);
};

let cryptowatch_ws;
async function cryptowatchWsSetup(
  cryptowatchMarketIds,
  PRICE_FEEDS,
  MM_CONFIG
) {
  if (cryptowatch_ws) {
    cryptowatch_ws.close();
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

      PRICE_FEEDS["cryptowatch:" + cryptowatchMarketIds[i]] =
        cryptowatchMarketPrices.result[key];
    } catch (e) {
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
  cryptowatch_ws.on("error", console.error);

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
    setTimeout(cryptowatchWsSetup, 5000, [
      cryptowatchMarketIds,
      PRICE_FEEDS,
      MM_CONFIG,
    ]);
  }
}

async function chainlinkSetup(chainlinkMarketAddress, PRICE_FEEDS) {
  const results = chainlinkMarketAddress.map(async (address) => {
    try {
      const aggregatorV3InterfaceABI = JSON.parse(
        fs.readFileSync("ABIs/chainlinkV3InterfaceABI.abi")
      );
      const provider = new ethers.Contract(
        address,
        aggregatorV3InterfaceABI,
        ethersProvider
      );
      const decimals = await provider.decimals();
      const key = "chainlink:" + address;
      CHAINLINK_PROVIDERS[key] = [provider, decimals];

      // get inital price
      const response = await provider.latestRoundData();
      PRICE_FEEDS[key] = parseFloat(response.answer) / 10 ** decimals;
    } catch (e) {
      throw new Error(
        "Error while setting up chainlink for " + address + ", Error: " + e
      );
    }
  });
  await Promise.all(results);
  setInterval(() => chainlinkUpdate(PRICE_FEEDS), 30000);
}

async function chainlinkUpdate(PRICE_FEEDS) {
  try {
    await Promise.all(
      Object.keys(CHAINLINK_PROVIDERS).map(async (key) => {
        const [provider, decimals] = CHAINLINK_PROVIDERS[key];
        const response = await provider.latestRoundData();
        PRICE_FEEDS[key] = parseFloat(response.answer) / 10 ** decimals;
      })
    );
    chainlink_error_counter = 0;
  } catch (err) {
    chainlink_error_counter += 1;
    console.log(`Failed to update chainlink, retry: ${err.message}`);
    if (chainlink_error_counter > 4) {
      throw new Error("Failed to update chainlink since 150 seconds!");
    }
  }
}

async function uniswapV3Setup(uniswapV3Address, PRICE_FEEDS) {
  const results = uniswapV3Address.map(async (address) => {
    try {
      const IUniswapV3PoolABI = JSON.parse(
        fs.readFileSync("ABIs/IUniswapV3Pool.abi")
      );
      const ERC20ABI = JSON.parse(fs.readFileSync("ABIs/ERC20.abi"));

      const provider = new ethers.Contract(
        address,
        IUniswapV3PoolABI,
        ethersProvider
      );

      let [slot0, addressToken0, addressToken1] = await Promise.all([
        provider.slot0(),
        provider.token0(),
        provider.token1(),
      ]);

      const tokenProvier0 = new ethers.Contract(
        addressToken0,
        ERC20ABI,
        ethersProvider
      );
      const tokenProvier1 = new ethers.Contract(
        addressToken1,
        ERC20ABI,
        ethersProvider
      );

      let [decimals0, decimals1] = await Promise.all([
        tokenProvier0.decimals(),
        tokenProvier1.decimals(),
      ]);

      const key = "uniswapv3:" + address;
      const decimalsRatio = 10 ** decimals0 / 10 ** decimals1;
      UNISWAP_V3_PROVIDERS[key] = [provider, decimalsRatio];

      // get inital price
      const price =
        (slot0.sqrtPriceX96 * slot0.sqrtPriceX96 * decimalsRatio) / 2 ** 192;
      PRICE_FEEDS[key] = price;
    } catch (e) {
      throw new Error(
        "Error while setting up uniswapV3 for " + address + ", Error: " + e
      );
    }
  });
  await Promise.all(results);
  setInterval(() => uniswapV3Update(PRICE_FEEDS), 30000);
}

async function uniswapV3Update(PRICE_FEEDS) {
  try {
    await Promise.all(
      Object.keys(UNISWAP_V3_PROVIDERS).map(async (key) => {
        const [provider, decimalsRatio] = UNISWAP_V3_PROVIDERS[key];
        const slot0 = await provider.slot0();
        PRICE_FEEDS[key] =
          (slot0.sqrtPriceX96 * slot0.sqrtPriceX96 * decimalsRatio) / 2 ** 192;
      })
    );
    // reset error counter if successful
    uniswap_error_counter = 0;
  } catch (err) {
    uniswap_error_counter += 1;
    console.log(`Failed to update uniswap, retry: ${err.message}`);
    console.log(err.message);
    if (uniswap_error_counter > 4) {
      throw new Error("Failed to update uniswap since 150 seconds!");
    }
  }
}
