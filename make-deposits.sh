# ## MAKE BTC DEPOSITS
cd ./mm-btc-usd/spot-mm
node ./spotDeposit.js
node ./spotDeposit.js 
node ./orderTabUpdates.js 

cd ../perp-mm
node ./perpDeposit.js
node ./perpDeposit.js


## MAKE ETH DEPOSITS
cd ../../mm-eth-usd/spot-mm
node ./spotDeposit.js
node ./spotDeposit.js
node ./orderTabUpdates.js 

cd ../perp-mm
node ./perpDeposit.js
node ./perpDeposit.js


## MAKE SOL DEPOSITS
cd ../../mm-sol-usd

node ./perpDeposit.js
node ./perpDeposit.js


