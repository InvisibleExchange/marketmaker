const dotenv = require("dotenv");
dotenv.config();

console.log(process.env.CRYPTOWATCH_API_KEY);



async function afterFill(chainId, orderId, wallet) {
  const order = PAST_ORDER_LIST[orderId];
  if(!order) { return; }
  const marketId = order.marketId;
  const mmConfig = MM_CONFIG.pairs[marketId];
  if(!mmConfig) { return; }

  // update account state from order
  const account_state = wallet['account_state'].committed.balances;
  const buyTokenParsed = syncProvider.tokenSet.parseToken (
      order.buySymbol,
      order.buyQuantity
  );
  const sellTokenParsed = syncProvider.tokenSet.parseToken (
      order.sellSymbol,
      order.sellQuantity
  );
  const oldBuyBalance = account_state[order.buySymbol] ? account_state[order.buySymbol] : '0';
  const oldSellBalance = account_state[order.sellSymbol] ? account_state[order.sellSymbol] : '0';
  const oldBuyTokenParsed = ethers.BigNumber.from(oldBuyBalance);
  const oldSellTokenParsed = ethers.BigNumber.from(oldSellBalance);
  account_state[order.buySymbol] = (oldBuyTokenParsed.add(buyTokenParsed)).toString();
  account_state[order.sellSymbol] = (oldSellTokenParsed.sub(sellTokenParsed)).toString();
  
  const indicateMarket = {};
  indicateMarket[marketId] = mmConfig;
  if(mmConfig.delayAfterFill) {
      let delayAfterFillMinSize
      if(
          !Array.isArray(mmConfig.delayAfterFill) ||
          !mmConfig.delayAfterFill[1]
      ) {
          delayAfterFillMinSize = 0;
      } else {
          delayAfterFillMinSize = mmConfig.delayAfterFill[1]
      }

      if(order.baseQuantity > delayAfterFillMinSize)  {
          // no array -> old config
          // or array and buyQuantity over minSize
          mmConfig.active = false;
          cancelLiquidity (chainId, marketId);
          console.log(`Set ${marketId} passive for ${mmConfig.delayAfterFill} seconds.`);
          setTimeout(() => {
              mmConfig.active = true;
              console.log(`Set ${marketId} active.`);
              indicateLiquidity(indicateMarket);
          }, mmConfig.delayAfterFill * 1000);   
      }             
  }

  // increaseSpreadAfterFill size might not be set
  const increaseSpreadAfterFillMinSize = (mmConfig.increaseSpreadAfterFill?.[2]) 
      ? mmConfig.increaseSpreadAfterFill[2]
      : 0
  if(
      mmConfig.increaseSpreadAfterFill &&
      order.baseQuantity > increaseSpreadAfterFillMinSize
      
  ) {
      const [spread, time] = mmConfig.increaseSpreadAfterFill;
      mmConfig.minSpread = mmConfig.minSpread + spread;
      console.log(`Changed ${marketId} minSpread by ${spread}.`);
      indicateLiquidity(indicateMarket);
      setTimeout(() => {
          mmConfig.minSpread = mmConfig.minSpread - spread;
          console.log(`Changed ${marketId} minSpread by -${spread}.`);
          indicateLiquidity(indicateMarket);
      }, time * 1000);
  }

  // changeSizeAfterFill size might not be set
  const changeSizeAfterFillMinSize = (mmConfig.changeSizeAfterFill?.[2]) 
      ? mmConfig.changeSizeAfterFill[2]
      : 0
  if(
      mmConfig.changeSizeAfterFill &&
      order.baseQuantity > changeSizeAfterFillMinSize
  ) {
      const [size, time] = mmConfig.changeSizeAfterFill;
      mmConfig.maxSize = mmConfig.maxSize + size;
      console.log(`Changed ${marketId} maxSize by ${size}.`);
      indicateLiquidity(indicateMarket);
      setTimeout(() => {
          mmConfig.maxSize = mmConfig.maxSize - size;
          console.log(`Changed ${marketId} maxSize by ${(size* (-1))}.`);
          indicateLiquidity(indicateMarket);
      }, time * 1000);
  }
}
