import "dotenv/config";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import { stringify } from "csv-stringify";
import pLimit from "p-limit";
import { classifyImage } from "./classifier.js";

const CONCURRENCY = 3; // max simultaneous API calls
const URL_COLUMN = "image_url"; // column name to look for in input CSV

/**
 * Process a CSV of product image URLs and append season classification columns.
 * @param {string} inputPath  - Path to input CSV (must have an `image_url` column)
 * @param {string} outputPath - Path to write the output CSV
 */
async function batchClassify(inputPath, outputPath) {
  // Read and parse the input CSV
  const rows = await new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(inputPath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on("data", (row) => records.push(row))
      .on("end", () => resolve(records))
      .on("error", reject);
  });

  if (rows.length === 0) {
    console.error("Input CSV is empty.");
    process.exit(1);
  }

  const firstRow = rows[0];
  const urlCol =
    Object.keys(firstRow).find((k) => k.toLowerCase() === URL_COLUMN) ??
    URL_COLUMN;

  if (!firstRow[urlCol]) {
    console.error(
      `Column "${URL_COLUMN}" not found in CSV. Found columns: ${Object.keys(firstRow).join(", ")}`
    );
    process.exit(1);
  }

  console.log(`Processing ${rows.length} products (concurrency: ${CONCURRENCY})…\n`);

  const limit = pLimit(CONCURRENCY);
  let completed = 0;

  const results = await Promise.all(
    rows.map((row, i) =>
      limit(async () => {
        const url = row[urlCol]?.trim();
        let classification;

        try {
          if (!url) throw new Error("Empty URL");
          classification = await classifyImage(url);
          completed++;
          console.log(
            `[${completed}/${rows.length}] ✓  ${url.slice(0, 60)}…  → ${classification.best_season}`
          );
        } catch (err) {
          completed++;
          console.error(`[${completed}/${rows.length}] ✗  Row ${i + 1}: ${err.message}`);
          classification = {
            dominant_colors: [],
            best_season: "error",
            confidence: "low",
            reasoning: err.message,
          };
        }

        return {
          ...row,
          dominant_colors: classification.dominant_colors.join("; "),
          best_season: classification.best_season,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
        };
      })
    )
  );

  // Write output CSV
  await new Promise((resolve, reject) => {
    const outputColumns = [
      ...Object.keys(rows[0]),
      "dominant_colors",
      "best_season",
      "confidence",
      "reasoning",
    ];

    const out = fs.createWriteStream(outputPath);
    const stringifier = stringify({ header: true, columns: outputColumns });
    stringifier.pipe(out);
    stringifier.on("error", reject);
    out.on("finish", resolve);

    for (const row of results) stringifier.write(row);
    stringifier.end();
  });

  console.log(`\nDone! Output written to: ${outputPath}`);
}

// CLI entry point
const [, , inputArg, outputArg] = process.argv;
const inputFile = inputArg ?? path.join("data", "sample_products.csv");
const outputFile =
  outputArg ??
  inputFile.replace(/\.csv$/i, "") + "_classified.csv";

batchClassify(inputFile, outputFile).catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
