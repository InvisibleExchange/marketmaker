## MAKE BTC DEPOSITS
node ./mm-btc-usd/spotDeposit.js
node ./mm-btc-usd/spotDeposit.js 

node ./mm-btc-usd/perpDeposit.js
node ./mm-btc-usd/perpDeposit.js


## MAKE ETH DEPOSITS
node ./mm-eth-usd/spotDeposit.js
node ./mm-eth-usd/spotDeposit.js

node ./mm-eth-usd/perpDeposit.js
node ./mm-eth-usd/perpDeposit.js


## MAKE SOL DEPOSITS
node ./mm-sol-usd/perpDeposit.js
node ./mm-sol-usd/perpDeposit.js

sleep 3

## OPEN ORDER TABS
node ./mm-btc-usd/orderTabUpdates.js 
node ./mm-eth-usd/orderTabUpdates.js 