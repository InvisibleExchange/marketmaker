const fs = require("fs");

// Step 4: Read the JSON file back into an object
fs.readFile("db_state.json", "utf8", (err, data) => {
  if (err) {
    console.error("Error reading JSON file:", err);
  } else {
    try {
      const parsedObject = JSON.parse(data, (key, value) => {
        if (/^\d+$/.test(value)) {
          return BigInt(value); // Convert strings to BigInt
        }
        return value;
      });
      let dbState = parsedObject;

      fs.readFile("dex_state.json", "utf8", (err, data) => {
        if (err) {
          console.error("Error reading JSON file:", err);
        } else {
          try {
            const parsedObject = JSON.parse(data, (key, value) => {
              if (/^\d+$/.test(value)) {
                return BigInt(value); // Convert strings to BigInt
              }
              return value;
            });
            let serverState = parsedObject;

            compareStates(dbState, serverState);
          } catch (parseErr) {
            console.error("Error parsing JSON:", parseErr);
          }
        }
      });
    } catch (parseErr) {
      console.error("Error parsing JSON:", parseErr);
    }
  }
});

function compareStates(dbState, serverState) {
  console.log(
    Object.keys(dbState).length,
    " ",
    Object.keys(serverState).length
  );
  for (let idx of Object.keys(dbState)) {
    let dbEl = dbState[idx];
    if (!serverState[idx]) {
      console.log(idx);
    }
    let serverEl = serverState[idx];
    if (dbEl != serverEl) {
      console.log(idx);
    } else {
      // console.log(dbEl, "==", serverEl);
    }
  }
}
