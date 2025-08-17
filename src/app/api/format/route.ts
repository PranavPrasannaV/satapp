import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

type ClassifyRequest = {
  questions: string[];
};

export async function POST(req: NextRequest) {
  try {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "";
  if (!apiKey) return new Response(JSON.stringify({ error: "Missing GOOGLE_API_KEY" }), { status: 500 });

    const body = (await req.json()) as Partial<ClassifyRequest>;
    const questions = Array.isArray(body.questions) ? body.questions.filter((q) => typeof q === "string" && q.trim().length > 0) : [];
    if (questions.length === 0) {
      return new Response(JSON.stringify({ error: "No questions provided" }), { status: 400 });
    }

    const systemInstruction = `You are an SAT question classifier. You will receive a list of user-missed SAT questions (raw text including stem and possibly answer choices). Group the questions by section and topic.

Rules:
- Section must be one of: "Reading" or "Math".
- Choose a concise, specific topic (e.g., punctuation, transitions, main idea, paired passages, linear equations, quadratic functions, interpreting graphs, systems of equations, proportions, geometry, probability, etc.).
- If multiple questions belong to the same section and topic, you MAY group them together under a single output item.
- Only use the provided questions; do not invent content.

Output strictly as JSON with this shape (no extra commentary):
[
  {
    "question": ["...one or more of the provided questions..."],
    "section": "Reading" | "Math",
    "topic": "Specific focus (e.g., punctuation, transitions, main idea, paired passages, linear equations, quadratic functions, interpreting graphs, vocabulary in context, etc.)"
  }
]
`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", systemInstruction });

    const userContent = [
      { text: `Here are the questions to classify:\n\n${questions.map((q, idx) => `Q${idx + 1}: ${q}`).join("\n\n")}` },
    ];

    const result = await model.generateContent({
      contents: [{ role: "user", parts: userContent }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    } as any);

    const text = result.response.text();

    // Validate JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected array JSON");
    } catch (err) {
      return new Response(JSON.stringify({ error: "Model did not return valid JSON", raw: text }), { status: 502 });
    }

    return new Response(JSON.stringify({ groups: parsed }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("/api/format error", error);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
}


