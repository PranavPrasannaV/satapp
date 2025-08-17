import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/** Simple explanation endpoint. Accepts { testId, section, topic, examples } */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "";
    if (!apiKey) return new Response(JSON.stringify({ error: "Missing GOOGLE_API_KEY" }), { status: 500 });
    const body = await req.json();
    const section = String(body.section || "").slice(0,100);
    const topic = String(body.topic || "").slice(0,200);
    const examples = String(body.examples || "").slice(0,5000);
    if (!section || !topic) return new Response(JSON.stringify({ error: "Missing section/topic" }), { status: 400 });

    const prompt = `You are an elite SAT tutor. Provide a concise but thorough teaching explanation for the following topic the student struggles with.
Section: ${section}
Topic: ${topic}
Student Miss Examples (raw references, may be paraphrased):\n${examples || '(no examples)'}

RETURN FORMAT (Markdown allowed, no front-matter):
1. Core Concept (2-3 sentences)
2. Common Mistakes (bulleted)
3. Step-by-Step Approach (numbered concise algorithm)
4. Mini Drill (1 new example question with 4 choices A-D, then answer + brief rationale). Do NOT reuse earlier example content.
Keep tone encouraging, precise, test-relevant. Avoid fluff.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 2048 }
    } as any);
    const text = result.response.text();

    return new Response(JSON.stringify({ explanation: text }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error("/api/learn/explain error", e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
}
