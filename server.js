import "dotenv/config";
import express from "express";
import { classifyImage } from "./src/classifier.js";

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("public"));

app.post("/api/classify", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return res.status(400).json({ error: "A valid image URL is required." });
  }
  try {
    const result = await classifyImage(url.trim());
    res.json(result);
  } catch (err) {
    const message = err.message ?? "Classification failed.";
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Goldenhue running at http://localhost:${PORT}`);
});
