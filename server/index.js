import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";
import pdfParse from "@bingsjs/pdf-parse";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_, res) => res.json({ ok: true }));

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing in server environment.");
  return new OpenAI({ apiKey: key });
}

async function extractTasksFromText({ text, courseName }) {
  const client = getOpenAI();

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            dueDate: { type: "string", description: "YYYY-MM-DD if explicit, else empty" },
            weight: { type: "number", description: "0-100, if unknown 0" },
            difficulty: { type: "number", description: "1-5" },
            notes: { type: "string" }
          },
          required: ["title", "dueDate", "weight", "difficulty", "notes"]
        }
      }
    },
    required: ["items"]
  };

  const resp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content:
          "Extract graded course items from syllabus text into JSON. " +
          "Only include graded items: quizzes, tests, midterms, labs, assignments, projects, research paper, final exam. " +
          "If a due date is not explicitly stated, leave dueDate empty. " +
          "If weight is not stated, use 0. " +
          "Difficulty is your best guess 1-5. Keep titles short."
      },
      { role: "user", content: `Course: ${courseName || "Unknown"}\n\nSyllabus text:\n${text}` }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "SyllabusTasks",
        strict: true,
        schema
      }
    },
    max_output_tokens: 1200
  });

  const raw = resp.output_text || "{}";
  const parsed = JSON.parse(raw);

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const cleaned = items
    .map((t) => ({
      title: String(t.title || "").trim(),
      dueDate: String(t.dueDate || "").trim(),
      weight: Math.max(0, Math.min(100, Number(t.weight) || 0)),
      difficulty: Math.max(1, Math.min(5, Number(t.difficulty) || 3)),
      notes: String(t.notes || "").trim()
    }))
    .filter((t) => t.title.length > 0);

  return { items: cleaned };
}

async function handleExtractFromUrl(req, res) {
  try {
    const { url, contentType, courseName } = req.body ?? {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url." });

    const r = await fetch(url);
    if (!r.ok) return res.status(400).json({ error: `Failed to download file (${r.status}).` });

    const buf = Buffer.from(await r.arrayBuffer());
    const ct = String(contentType || "").toLowerCase();
    const lowerUrl = url.toLowerCase();

    let text = "";

    if (ct.includes("pdf") || lowerUrl.endsWith(".pdf")) {
      const parsed = await pdfParse(buf);
      text = parsed?.text || "";
    } else if (ct.includes("text/plain") || lowerUrl.endsWith(".txt")) {
      text = buf.toString("utf8");
    } else {
      return res.status(400).json({ error: "Only PDF and TXT supported for extraction right now." });
    }

    if (text.trim().length < 30) {
      return res.status(400).json({ error: "Could not extract readable text from file." });
    }

    const result = await extractTasksFromText({ text, courseName });
    return res.json(result);
  } catch (err) {
    console.error("extract-from-url error:", err);
    return res.status(500).json({
      error: "Server extraction failed.",
      detail: String(err?.message || err)
    });
  }
}

async function handleExtractTasks(req, res) {
  try {
    const { text, courseName } = req.body ?? {};
    if (!text || typeof text !== "string" || text.trim().length < 30) {
      return res.status(400).json({ error: "Missing syllabus text." });
    }
    const result = await extractTasksFromText({ text, courseName });
    return res.json(result);
  } catch (err) {
    console.error("extract-tasks error:", err);
    return res.status(500).json({
      error: "Extraction failed.",
      detail: String(err?.message || err)
    });
  }
}

app.post("/extract-from-url", handleExtractFromUrl);
app.post("/api/extract-from-url", handleExtractFromUrl);

app.post("/extract-tasks", handleExtractTasks);
app.post("/api/extract-tasks", handleExtractTasks);

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`server running on http://localhost:${PORT}`));
