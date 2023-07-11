let ftr;
async function main() {
  console.log("Hello, world!");

  setTimeout(() => {
    console.log("timeout 1");

    console.log("ftr", ftr);

    delete ftr;
  }, 2000);

  ftr = new Promise((resolve) => setTimeout(resolve, 10_000));

  console.log("ftr", ftr);

  await ftr;

  console.log("goodbye, world!");
}

main();
