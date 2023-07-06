const User = require("../users/Invisibl3User");

const { IDS_TO_SYMBOLS, PRICE_DECIMALS_PER_ASSET } = require("./utils");
const {
  checkNoteExistance,
  checkPositionExistance,
} = require("./firebase/firebaseConnection");
const { storeUserState } = require("./localStorage");

// ! RESTORE KEY DATA ========================================================================

/**
 *
 * @param {bigint|string} originPrivKey
 * @param {number[]} tokens
 * @param {boolean} isPerpetual - if true retrieve position keys else retrieve note keys
 */
async function restoreKeyData(
  user,
  isPerpetual = false,
  tokens = [12345, 54321, 55555]
) {
  // ? Get all the addresses from the datatbase =====

  if (isPerpetual) {
    let positionPrivKeys = {};
    for (let token of tokens) {
      if (!PRICE_DECIMALS_PER_ASSET[token]) continue;

      let counter = 0;
      for (let i = 0; i < 16; i++) {
        let { positionPrivKey, positionAddress } =
          user.getPositionAddress(token);

        checkPositionExistance(positionAddress.getX().toString()).then(
          (keyExists) => {
            if (keyExists) {
              positionPrivKeys[positionAddress.getX().toString()] =
                positionPrivKey;
            }

            counter++;
          }
        );
      }

      while (counter < 16) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    return positionPrivKeys;
  } else {
    let privKeys = {};
    for (let token of tokens) {
      if (!IDS_TO_SYMBOLS[token]) continue;

      let counter = 0;
      for (let i = 0; i < 32; i++) {
        let { KoR, koR, _ } = user.getDestReceivedAddresses(token);

        checkNoteExistance(KoR.getX().toString()).then((keyExists) => {
          if (keyExists) {
            privKeys[KoR.getX().toString()] = koR;
          }

          counter++;
        });
      }

      while (counter < 32) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    return privKeys;
  }
}

/**
 *
 * @param {bigint|string} originPrivKey
 * @param {boolean} restoreNotes  - if true retrieve note keys
 * @param {boolean} restorePositions - if true retrieve position keys
 */
async function restoreUserState(originPrivKey, restoreNotes, restorePositions) {
  let user = User.fromPrivKey(originPrivKey.toString());
  await user.login();

  if (restoreNotes) {
    let privKeys = await restoreKeyData(user, false);
    console.log("note keyData: ", privKeys);

    user.notePrivKeys = privKeys;
  }
  if (restorePositions) {
    let posPrivKeys = await restoreKeyData(user, true);
    console.log("position keyData: ", posPrivKeys);

    user.positionPrivKeys = posPrivKeys;
  }

  storeUserState(user.db, user);
}

module.exports = { restoreUserState };
