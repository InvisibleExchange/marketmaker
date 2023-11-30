# marketmaker

The market maker code for invisible Exchange.

<img height=250 src="https://github.com/InvisibleExchange/frontend/blob/main/public/Invisible-full.png"> </img>

## Description

This is the market maker code to create and run your own mm strategies on Invisible L2.
There are two main components that you need to know about:

- The first is the [invisible-sdk](https://github.com/InvisibleExchange/invisible-sdk) that is responsible for storing and keep track of your local state and building and sending orders. You can find some [examples here](https://github.com/InvisibleExchange/invisible-sdk/examples).
- And the second is the environment where you can create your custom marketmaker strategies or customize the default one.

This repository is specificaly about the latter.

## Examples

The TradingEnv directory contains all the logic along with a default example strategy that you can use to run a marketMaker.

Define the configurations in the config.json

```json
{
  // Todo: Delete all the comments
  "SERVER_URL": "localhost",
  "RELAY_WS_URL": "ws://localhost:4040",
  "CONFIG_CODE": 0,
  "PERIODS": {
    // all in milliseconds
    "REFRESH_PERIOD": 20000000, // How often to refresh the MM state to make sure it's up to date
    "LIQUIDITY_INDICATION_PERIOD": 5000, // How often to refresh the orders
    "REFRESH_ORDERS_PERIOD": 300000, // How often to cancel all orders and completely refresh
    "FILL_ORDERS_PERIOD": 3000, // How often to check if there are any fillable orders
    "PRICE_UPDATE_PERIOD": 30000 // How often to update the price
  },
  "MM_CONFIG": {
    "EXPIRATION_TIME": 10, // order expiration time in seconds
    "config": {
      "symbol": "BTC",
      "market_id": 21,
      "name": "bitcoin",
      "coinmarketcapId": 1,
      "slippageRate": 1e-4,
      "maxSize": 10,
      "minSize": 0.00003,
      "minSpread": 0.0005,
      "active": true,
      "maxLeverage": 2
    }
  }
}
```

The TradingEnv defines the environment logic to define your strategies.
You can find the run function in PerpMmEnvTemplate.js file to define your strategy or use the default one.

```js
 async run() {
    // TODO: ===================================================
    // TODO: INSERT MARKET MAKER LOGIC HERE
    // TODO: ===================================================


 }
```

and run it with runEnvExample.js.
