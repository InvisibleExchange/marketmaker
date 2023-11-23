# marketmaker

The market maker code for invisible Exchange.

<img height=250 src="https://github.com/InvisibleExchange/frontend/blob/main/public/Invisible-full.png"> </img>

## Description

This is the market maker code to create and run your own mm strategies on Invisible L2.
There are two main components that you need to know about:

- The first is the main Exchange logic that is responsible for storing and keep track of your state and building and sending orders. The functions that you need to know about are descibed here: [Orders](https://github.com/InvisibleExchange/marketmaker/blob/main/ORDERS.md)
- And the second is the environment where you can create your custom marketmaker strategies or customize the default one.

## Examples

Define the configurations in the config.json

```json
{
  "privKey": "0x44444444444444444444444444444444444444444444444444444444445",
  "SERVER_URL": "localhost",
  "EXPIRATION_TIME": 10,
  "config": {
    "symbol": "BTC",
    "market_id": 21,
    "name": "bitcoin",
    "slippageRate": 1e-4,
    "maxSize": 10,
    "minSize": 0.00003,
    "minSpread": 0.0005,
    "active": true,
    "maxLeverage": 2
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

