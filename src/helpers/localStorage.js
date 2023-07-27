const sqlite3 = require("sqlite3").verbose();

async function initDb() {
  const createTableCommand = `
  CREATE TABLE IF NOT EXISTS user_data 
    (userId text PRIMARY KEY NOT NULL UNIQUE, 
    privKeys TEXT,
    positionPrivKeys TEXT,
    tabPrivKeys TEXT,
    orderIds TEXT,
    perpetualOrderIds TEXT,
    noteCounts TEXT,
    positionCounts TEXT,
    orderTabCounts TEXT
    )`;

  let db = new sqlite3.Database("../user_info.db", (err) => {
    if (err) {
      console.error(err.message);
    }
  });

  let done = false;
  db.run(createTableCommand).wait(() => {
    done = true;
  });

  while (!done) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return db;
}

function storeUserState(db, user) {
  let userId = user.userId;

  let pks = Object.values(user.notePrivKeys).map((pk) => pk.toString());
  let privKeys = JSON.stringify(pks);
  let posPks = Object.values(user.positionPrivKeys).map((pk) => pk.toString());
  let positionPrivKeys = JSON.stringify(posPks);
  let tabPks = Object.values(user.tabPrivKeys).map((pk) => pk.toString());
  let tabPrivKeys = JSON.stringify(tabPks);

  let orderIds = JSON.stringify(user.orderIds);
  let perpetualOrderIds = JSON.stringify(user.perpetualOrderIds);

  let noteCounts = JSON.stringify(user.noteCounts);
  let positionCounts = JSON.stringify(user.positionCounts);
  let orderTabCounts = JSON.stringify(user.orderTabCounts);

  // Update the state in the database
  try {
    db.run(
      `INSERT OR REPLACE INTO user_data (
        userId,
        privKeys,
        positionPrivKeys,
        tabPrivKeys,
        orderIds,
        perpetualOrderIds,
        noteCounts,
        positionCounts,
        orderTabCounts) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId.toString(),
        privKeys,
        positionPrivKeys,
        tabPrivKeys,
        orderIds,
        perpetualOrderIds,
        noteCounts,
        positionCounts,
        orderTabCounts,
      ]
    );
  } catch (e) {
    console.log(e);
  }
}

async function getUserState(db, userId) {
  //
  userId = userId.toString();

  const query = `SELECT * FROM user_data`;
  return new Promise((resolve, reject) => {
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error(err.message);
        reject(err);
      }

      let correctRow;
      for (let row of rows) {
        if (row.userId == userId) {
          correctRow = row;
        }
      }

      let privKeys = correctRow ? JSON.parse(correctRow?.privKeys) : [];
      let positionPrivKeys = correctRow
        ? JSON.parse(correctRow?.positionPrivKeys)
        : [];
      let tabPrivKeys = correctRow ? JSON.parse(correctRow?.tabPrivKeys) : [];

      let orderIds = correctRow ? JSON.parse(correctRow?.orderIds) : [];
      let perpetualOrderIds = correctRow
        ? JSON.parse(correctRow?.perpetualOrderIds)
        : [];
      let noteCounts = correctRow ? JSON.parse(correctRow?.noteCounts) : {};
      let positionCounts = correctRow
        ? JSON.parse(correctRow?.positionCounts)
        : {};
      let orderTabCounts = correctRow
        ? JSON.parse(correctRow?.orderTabCounts)
        : {};

      resolve({
        privKeys,
        positionPrivKeys,
        tabPrivKeys,
        orderIds,
        perpetualOrderIds,
        noteCounts,
        positionCounts,
        orderTabCounts,
      });
    });
  });
}

module.exports = {
  initDb,
  storeUserState,
  getUserState,
};
