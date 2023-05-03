async function storeNewNote(note) {
  //
  let hash8 = trimHash(note.blinding, 64);
  let hiddenAmount = bigInt(note.amount).xor(hash8).value;

  let addr = note.address.getX().toString();

  // TODO let dbDocId = addr + "-" + note.index.toString();

  let noteAddressDoc = doc(db, `notes/${addr}/indexes`, note.index.toString());
  let noteAddressData = await getDoc(noteAddressDoc);

  if (noteAddressData.exists()) {
    await updateDoc(noteAddressDoc, {
      index: note.index.toString(),
      token: note.token.toString(),
      commitment: note.commitment.toString(),
      address: [addr, note.address.getY().toString()],
      hidden_amount: hiddenAmount.toString(),
    });
  } else {
    await setDoc(noteAddressDoc, {
      index: note.index.toString(),
      token: note.token.toString(),
      commitment: note.commitment.toString(),
      address: [addr, note.address.getY().toString()],
      hidden_amount: hiddenAmount.toString(),
    });
  }
}

async function removeNoteFromDb(note) {
  //

  let addr = note.address.getX().toString();

  let noteAddressDoc = doc(db, `notes/${addr}/indexes`, note.index.toString());
  let noteAddressData = await getDoc(noteAddressDoc);

  if (noteAddressData.exists()) {
    await deleteDoc(noteAddressDoc);
  }
}

async function storeNewPosition(positionObject) {
  let addr = positionObject.position_address;

  let positionAddressDoc = doc(
    db,
    `positions/${addr}/indexes`,
    positionObject.index.toString()
  );
  let positionAddressData = await getDoc(positionAddressDoc);

  if (positionAddressData.exists()) {
    await updateDoc(positionAddressDoc, {
      order_side: positionObject.order_side.toString(),
      synthetic_token: positionObject.synthetic_token.toString(),
      collateral_token: positionObject.collateral_token.toString(),
      position_size: positionObject.position_size.toString(),
      margin: positionObject.margin.toString(),
      entry_price: positionObject.entry_price.toString(),
      liquidation_price: positionObject.liquidation_price.toString(),
      bankruptcy_price: positionObject.bankruptcy_price.toString(),
      position_address: positionObject.position_address,
      last_funding_idx: positionObject.last_funding_idx.toString(),
      hash: positionObject.hash.toString(),
      index: positionObject.index,
    });
  } else {
    await setDoc(positionAddressDoc, {
      order_side: positionObject.order_side.toString(), //
      synthetic_token: positionObject.synthetic_token.toString(),
      collateral_token: positionObject.collateral_token.toString(), //
      position_size: positionObject.position_size.toString(),
      margin: positionObject.margin.toString(), //
      entry_price: positionObject.entry_price.toString(), //
      liquidation_price: positionObject.liquidation_price.toString(), //
      bankruptcy_price: positionObject.bankruptcy_price.toString(), //
      position_address: positionObject.position_address, //
      last_funding_idx: positionObject.last_funding_idx.toString(), //
      hash: positionObject.hash.toString(), //
      index: positionObject.index, //
    });
  }
}

async function removePositionFromDb(positionAddressX, index) {
  //

  let positionAddressDoc = doc(
    db,
    `positions/${positionAddressX}/indexes`,
    index.toString()
  );
  let positionAddressData = await getDoc(positionAddressDoc);

  if (positionAddressData.exists()) {
    await deleteDoc(positionAddressDoc);
  }
}

async function fetchLiquidatablePositions(index_price) {
  const querySnapshot = await getDocs(collection(db, `positions`));

  if (querySnapshot.empty) {
    return [];
  }

  let liquidablePositions = [];
  querySnapshot.forEach(async (doc) => {
    let positionAddr = doc.id;

    const querySnapshot = await getDocs(
      collection(db, `positions/${positionAddr}/indexes`)
    );

    if (querySnapshot.empty) {
      return;
    }

    querySnapshot.forEach(async (doc) => {
      let positionData = doc.data();

      if (
        (positionData == "Long" &&
          index_price <= positionData.liquidation_price) ||
        (positionData == "Short" &&
          index_price >= positionData.liquidation_price)
      ) {
        liquidablePositions.push(positionData);
      }
    });
  });
}
