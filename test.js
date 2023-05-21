const {
  _getLiquidationPrice,
} = require("./src/helpers/tradePriceCalculations.js");

let entry_price = 1800_000_000;
let margin = 100_000_000;
let position_size = 1_000_000_000;
let order_side = "Long";
let synthetic_token = 54321;

let p = _getLiquidationPrice(
  entry_price,
  margin,
  position_size,
  order_side,
  synthetic_token,
  true
);

console.log(p);
