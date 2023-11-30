const {
  _cancelLiquidity,
  _getMarkPrice,
  _listenToWebSocket,
} = require("./tradingEnvHelpers");
const {
  fillOpenOrders,
  indicateLiquidity,
  initPositions,
} = require("./defaultStrategy/order");

const { priceUpdate } = require("./defaultStrategy/mmPriceFeeds");

const { restoreUserState } = require("invisible-sdk/src/utils");

// * =============================================================================================================

module.exports = class TradingEnvironment {
  constructor(marketmaker, config) {
    this.marketmaker = marketmaker;
    this.isPerp = true;
    // ! config
    this.CONFIG_CODE = config.CONFIG_CODE ? Number(config.CONFIG_CODE) : null;
    this.SERVER_URL = config.SERVER_URL;
    this.RELAY_WS_URL = config.RELAY_WS_URL;
    this.marketId = Number(config.marketId);
    this.PERIODS = config.PERIODS;
    this.MM_CONFIG = config.MM_CONFIG;
    // ! Globals
    this.PRICE_FEEDS = {};
    this.ACTIVE_ORDERS = {};
    this.shouldRestoreState = false;
    this.restartCount = 0;
    // ! order book liquidity
    // this.liquidity = {};
    // this.setLiquidity = (liquidity) => (this.liquidity = liquidity);
    this.perpLiquidity = {};
    this.setPerpLiquidity = (perpLiquidity) =>
      (this.perpLiquidity = perpLiquidity);

    // ! Functions
    this.listenToWebSocket();
  }

  async runMarketmaker() {
    setInterval(() => {
      this.restartCount = 0;
    }, 3600_000); // 1 hour

    await this.safeRun();
  }

  // * RUN THE MARKET MAKER
  async run() {
    // TODO: ===================================================
    // TODO: INSERT MARKET MAKER LOGIC HERE
    // TODO: ===================================================
    //
    //

    // ====================================================================
    // NOTE: AN EXAMPLE OF HOW TO USE THE MARKET MAKER ==================

    return new Promise(async (resolve, reject) => {
      // ! Setup price feeds
      let priceFeedInterval;
      try {
        await priceUpdate(this.PRICE_FEEDS, this.MM_CONFIG);
        priceFeedInterval = setInterval(async () => {
          await priceUpdate(this.PRICE_FEEDS, this.MM_CONFIG);
        }, this.PERIODS.PRICE_UPDATE_PERIOD);
      } catch (error) {
        console.log("Error setting up price feeds: ", error);
      }

      // ! Cancel any previous order
      await this.cancelLiquidity();

      let errorCounter = 0;

      await initPositions(
        this.marketId,
        this.marketmaker,
        this.MM_CONFIG,
        this.PRICE_FEEDS,
        this.ACTIVE_ORDERS,
        errorCounter
      );

      // Check for fillable orders
      let fillInterval = setInterval(async () => {
        await fillOpenOrders(
          this.marketId,
          this.perpLiquidity,
          this.marketmaker,
          this.MM_CONFIG,
          this.PRICE_FEEDS,
          this.ACTIVE_ORDERS,
          errorCounter
        );
      }, this.PERIODS.FILL_ORDERS_PERIOD);

      console.log("Starting market making: ", this.marketmaker.positionData);

      // brodcast orders to provide liquidity
      await indicateLiquidity(
        this.marketId,
        this.marketmaker,
        this.MM_CONFIG,
        this.PRICE_FEEDS,
        this.ACTIVE_ORDERS,
        errorCounter
      );
      let brodcastInterval = setInterval(async () => {
        await indicateLiquidity(
          this.marketId,
          this.marketmaker,
          this.MM_CONFIG,
          this.PRICE_FEEDS,
          this.ACTIVE_ORDERS,
          errorCounter
        );
      }, this.PERIODS.LIQUIDITY_INDICATION_PERIOD);

      let errorInterval = setInterval(() => {
        if (errorCounter > 10) {
          clearInterval(fillInterval);
          clearInterval(brodcastInterval);
          clearInterval(errorInterval);
          clearInterval(refreshInterval);
          clearInterval(priceFeedInterval);
          reject(Error("Too many errors. Restarting..."));
        }

        errorCounter = 0;
      }, 4 * this.PERIODS.LIQUIDITY_INDICATION_PERIOD);

      let refreshInterval = setInterval(async () => {
        let res = await this.refreshOrders(
          fillInterval,
          brodcastInterval,
          errorCounter
        );
        fillInterval = res.fillInterval;
        brodcastInterval = res.brodcastInterval;
      }, this.PERIODS.REFRESH_ORDERS_PERIOD);

      await new Promise((resolve) =>
        setTimeout(resolve, this.PERIODS.REFRESH_PERIOD)
      );
      clearInterval(fillInterval);
      clearInterval(brodcastInterval);
      // clearInterval(errorInterval);
      clearInterval(refreshInterval);
      clearInterval(priceFeedInterval);

      resolve();
    });

    // NOTE: ===========================================================
  }

  // * Run the market maker with error handling
  async safeRun() {
    try {
      await this.run();

      if (this.marketmaker && this.shouldRestoreState) {
        await restoreUserState(this.marketmaker, true, true);
        this.shouldRestoreState = false;
      }

      await this.safeRun();
    } catch (error) {
      this.restartCount++;
      console.log("Error: ", error.message);

      if (this.marketmaker && this.shouldRestoreState) {
        await restoreUserState(this.marketmaker, true, true);
        this.shouldRestoreState = false;
      }

      if (this.restartCount >= 5) {
        console.log("Too many restarts. Exiting...");

        // Note: This gets called when the bot is stopped for too many errors
        // this.onExit();

        process.exit(1);
      }

      await this.safeRun();
    }
  }

  // * Websocket connection
  listenToWebSocket = () => {
    _listenToWebSocket(
      this.CONFIG_CODE,
      this.SERVER_URL,
      this.RELAY_WS_URL,
      this.marketmaker,
      null,
      null,
      this.perpLiquidity,
      this.setPerpLiquidity,
      this.ACTIVE_ORDERS
    );
  };

  async cancelLiquidity() {
    return await _cancelLiquidity(this.marketId, this.marketmaker, this.isPerp);
  }

  async refreshOrders(fillInterval, brodcastInterval, errorCounter) {
    clearInterval(fillInterval);
    clearInterval(brodcastInterval);

    // cancel open orders
    if (this.marketmaker) {
      await this.cancelLiquidity();
    }

    this.ACTIVE_ORDERS = {};

    // brodcast orders to provide liquidity
    await indicateLiquidity(
      this.marketId,
      this.marketmaker,
      this.MM_CONFIG,
      this.PRICE_FEEDS,
      this.ACTIVE_ORDERS,
      errorCounter
    );
    brodcastInterval = setInterval(
      indicateLiquidity,
      this.PERIODS.LIQUIDITY_INDICATION_PERIOD
    );

    fillInterval = setInterval(async () => {
      await fillOpenOrders(
        this.marketId,
        this.perpLiquidity,
        this.marketmaker,
        this.MM_CONFIG,
        this.PRICE_FEEDS,
        this.ACTIVE_ORDERS,
        errorCounter
      );
    }, this.PERIODS.FILL_ORDERS_PERIOD);

    return { fillInterval, brodcastInterval };
  }

  // * Helpers
  getMarkPrice(token) {
    return _getMarkPrice(token, this.perpLiquidity);
  }
};

// ===================================================
