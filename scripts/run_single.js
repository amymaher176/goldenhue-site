import "dotenv/config";
import { classifyImage } from "../src/classifier.js";

const TEST_URL =
  "https://s7d2.scene7.com/is/image/aeo/5494_4021_519_f?$pdp-mz-opt$&fmt=webp";

const url = process.argv[2] ?? TEST_URL;

console.log(`Classifying: ${url}\n`);

classifyImage(url)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
