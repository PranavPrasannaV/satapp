import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

type GenerateRequest = {
  section: string; // Reading | Math
  topic: string;
  recentMistakes?: string[]; // raw question texts for this topic
  difficulty?: "Easy" | "Medium" | "Hard" | "Insane";
  count?: number; // default 10
};

export async function POST(req: NextRequest) {
  try {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "";
  if (!apiKey) return new Response(JSON.stringify({ error: "Missing GOOGLE_API_KEY" }), { status: 500 });

    const body = (await req.json()) as Partial<GenerateRequest>;
    const section = String(body.section || "").trim();
    const topic = String(body.topic || "").trim();
    const count = typeof body.count === "number" && body.count > 0 ? Math.min(10, body.count) : 10;
    const recentMistakes = Array.isArray(body.recentMistakes) ? body.recentMistakes.filter((q) => typeof q === "string" && q.trim().length > 0) : [];
    // Pull adaptive difficulty if not provided
    let difficulty = (body.difficulty as GenerateRequest["difficulty"]) || "" as any;
    try {
      const key = `sat-topic-difficulty-v1`;
      const raw = (globalThis as any).process ? undefined : undefined;
    } catch {}
    if (!difficulty) {
      try {
        const mapRaw = (global as any).localStorage?.getItem("sat-topic-difficulty-v1");
        // In edge runtime, no localStorage; the client supplies difficulty when needed
      } catch {}
      // default
      difficulty = "Medium" as any;
    }

    if (!section || !topic) {
      return new Response(JSON.stringify({ error: "Missing section or topic" }), { status: 400 });
    }

  const prompt = `Role: You are an expert SAT tutor and adaptive AI coach who creates highly SAT-relevant practice question sets, targeted to the student's chosen topic and skill level. You adjust difficulty dynamically to maximize learning efficiency and score gains.

- EVERY QUESTION SET YOU GENERATE MUST BE EXACTLY LIKE THE MISSED QUESTIONS PROVIDED, ALMOST LIKE A 1 to 1 REPLICA, THERE SHOULD BE NO DIFFERENCE IN FORMAT, SO THAT IT FOLLOWS THE SAT FORMAT(E.g if the student's missed question is a fill in the blank question with most logical word or phrase, you must generate a fill in the blank question. You must copy the exact question type for the give sat missed topic).
SETTINGS
Section: ${section}
Topic: ${topic}
Number of Questions per Set: 10
Recent Mistake: ${recentMistakes.length > 0 ? recentMistakes.join("\n\n---\n\n") : "(none provided)"}

 DIFFICULTY SYSTEM (Improved Modulation)
 Start at ${String(difficulty).toLowerCase()} difficulty unless the recent mistake suggests otherwise.
Use SAT-style difficulty tiers: Hard, Insane. After the set: 80%+ correct → increase tier; <50% → decrease tier and explain fundamentals; 50–79% → keep tier and vary formats.

RULES FOR QUESTION CREATION
- Every question must follow official SAT format, scope, and reasoning steps. Avoid trivia. MAKE EVERY SINGLE QUESTION EXACTLY LIKE THE MISSED QUESTIONS PROVIDED, ALMOST LIKE A 1 to 1 REPLICA.
- Math is solvable without a calculator unless labeled otherwise.
- Reading/Writing passages should be concise but reflect SAT style and complexity.
- Ensure a logical progression in the set.

SESSION FLOW
Generate one set of 10 questions based on section, topic, and difficulty.
Present all questions at once (numbered clearly).
Do NOT include hints, hints sections, tooltips, or any extra coaching text. Only supply the question objects.

RESPONSE FORMAT
Return STRICT JSON with an array named "questions" of length 10. Do not include any commentary besides the JSON. Do NOT add any field for hints. Each element must have this exact shape (and no extra fields):
{
  "question": "string",
  "multipleChoiceOptions": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "correctAnswer": "A" | "B" | "C" | "D",
  "incorrectExplanations": {
    "A": "why A is wrong",
    "B": "why B is wrong",
    "C": "why C is wrong",
    "D": "why D is wrong"
  },
  "correctExplanation": "why the correct option is right"
}
`;

    const genAI = new GoogleGenerativeAI(apiKey);
     const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
    } as any);

    const text = result.response.text();

    let parsed: any;
    try {
      parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.questions)) throw new Error("Invalid JSON shape");
    } catch (e) {
      return new Response(JSON.stringify({ error: "Model did not return valid JSON", raw: text }), { status: 502 });
    }

    // Sanitize: remove standalone occurrences of the word 'blank' (case-insensitive) from question stems/options
    try {
      if (Array.isArray(parsed.questions)) {
        parsed.questions = parsed.questions.map((q: any) => {
          if (q && typeof q === 'object') {
            const clean = (s: any) => typeof s === 'string' ? s.replace(/\bblank\b/gi, '').replace(/\s{2,}/g, ' ').trim() : s;
            return {
              ...q,
              question: clean(q.question),
              multipleChoiceOptions: Array.isArray(q.multipleChoiceOptions) ? q.multipleChoiceOptions.map(clean) : q.multipleChoiceOptions,
              incorrectExplanations: q.incorrectExplanations,
              correctExplanation: q.correctExplanation,
            };
          }
          return q;
        });
      }
    } catch {}

    return new Response(JSON.stringify(parsed), { status: 200, headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("/api/generate error", error);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
}


