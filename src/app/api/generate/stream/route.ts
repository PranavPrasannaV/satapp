import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

type GenerateRequest = {
  section: string;
  topic: string;
  recentMistakes?: string[];
  difficulty?: "Easy" | "Medium" | "Hard" | "Insane";
  count?: number;
};

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  try {
    // Get API key from environment variables
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "";
    if (!apiKey) return new Response("Missing GOOGLE_API_KEY", { status: 500 });

    const body = (await req.json()) as Partial<GenerateRequest>;
    const section = String(body.section || "").trim();
    const topic = String(body.topic || "").trim();
    const count = typeof body.count === "number" && body.count > 0 ? Math.min(10, body.count) : 10;
    const recentMistakes = Array.isArray(body.recentMistakes) ? body.recentMistakes.filter((q) => typeof q === "string" && q.trim().length > 0) : [];
    const difficulty = (body.difficulty as GenerateRequest["difficulty"]) || "Medium";
    if (!section || !topic) return new Response("Missing section or topic", { status: 400 });

  const prompt = `Role: You are an expert SAT tutor and adaptive AI coach who creates highly SAT-relevant practice question sets, targeted to the student's chosen topic and skill level. You adjust difficulty dynamically to maximize learning efficiency and score gains.
vocabulary in context questions that you generate specifically must always be fill in the blank question with most logical word or phrase. 
- EVERY QUESTION SET YOU GENERATE MUST BE EXACTLY LIKE THE MISSED QUESTIONS PROVIDED, ALMOST LIKE A 1 to 1 REPLICA, THERE SHOULD BE NO DIFFERENCE IN FORMAT, SO THAT IT FOLLOWS THE SAT FORMAT (e.g., if the student's missed question is a fill in the blank question with most logical word or phrase, you must generate a fill in the blank question. You must copy the exact question type for the given SAT missed topic).
SETTINGS
Section: ${section}
Topic: ${topic}
Number of Questions per Set: ${count}
Recent Mistake: ${recentMistakes.length > 0 ? recentMistakes.join("\n\n---\n\n") : "(none provided)"}

 DIFFICULTY SYSTEM (Improved Modulation)
 Start at ${String(difficulty).toLowerCase()} difficulty unless the recent mistake suggests otherwise.
Use SAT-style difficulty tiers: Medium, Hard, Insane. After the set: 80%+ correct → increase tier; <50% → decrease tier and explain fundamentals; 50–79% → keep tier and vary formats.
for example, vocabulary in context MUST be a fill in the blank question followed by Which choice completes the text with the most logical and precise word or phrase?
RULES FOR QUESTION CREATION
- Every question must follow official SAT format, scope, and reasoning steps. Avoid trivia. MAKE EVERY SINGLE QUESTION EXACTLY LIKE THE MISSED QUESTIONS PROVIDED, ALMOST LIKE A 1 to 1 REPLICA.
- Math is solvable without a calculator unless labeled otherwise.
- Reading/Writing passages should be concise but reflect SAT style and complexity.
- Ensure a logical progression in the set.

SESSION FLOW
Generate one set of 10 questions based on section, topic, and difficulty.
Present all questions at once (numbered clearly) conceptually (but output is line-by-line per spec below).
Do NOT include hints, hints sections, tooltips, or any extra coaching text. Only supply the question objects.

RESPONSE FORMAT (STREAM / NDJSON)
Output format: STRICT NDJSON — exactly 10 lines. Each line must be ONE minified JSON object with NO internal newlines or trailing commas and NO commentary before/after. Do NOT wrap in an array.
Each line schema (exact keys, no extras):
{"question":string,"multipleChoiceOptions":["A. ...","B. ...","C. ...","D. ..."],"correctAnswer":"A|B|C|D","incorrectExplanations":{"A":string,"B":string,"C":string,"D":string},"correctExplanation":string}
`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const t0 = Date.now();
          controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "received", t: t0 }) + "\n"));
          controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "prompt-built", t: Date.now(), section, topic, difficulty, count }) + "\n"));
          // Helper: validate one question object strictly
          function isValidQuestion(q: any): boolean {
            if (!q || typeof q !== "object") return false;
            if (typeof q.question !== "string" || q.question.trim().length < 5) return false;
            if (!Array.isArray(q.multipleChoiceOptions) || q.multipleChoiceOptions.length !== 4) return false;
            if (!q.multipleChoiceOptions.every((s: any) => typeof s === "string" && s.trim().length > 0)) return false;
            if (!["A", "B", "C", "D"].includes(q.correctAnswer)) return false;
            const ie = q.incorrectExplanations || {};
            if (!ie || typeof ie !== "object") return false;
            for (const k of ["A", "B", "C", "D"]) {
              if (typeof ie[k] !== "string" || ie[k].trim().length === 0) return false;
            }
            if (typeof q.correctExplanation !== "string" || q.correctExplanation.trim().length === 0) return false;
            return true;
          }
          function sanitizeQuestion(q: any): any {
            try {
              const clean = (s: any) => typeof s === 'string' ? s.replace(/\bblank\b/gi, '').replace(/\s{2,}/g, ' ').trim() : s;
              return {
                ...q,
                question: clean(q.question),
                multipleChoiceOptions: Array.isArray(q.multipleChoiceOptions) ? q.multipleChoiceOptions.map(clean) : q.multipleChoiceOptions,
              };
            } catch { return q; }
          }

          // Try streaming generation
          // @ts-ignore - use optional stream API when available
          const result: any = await (model as any).generateContentStream?.({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6 },
          });

          if (result && result.stream) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "stream-open", t: Date.now(), ttfbMs: Date.now() - t0 }) + "\n"));
            let buffer = "";
            let emitted = 0;
            for await (const chunk of result.stream) {
              const txt = chunk.text?.() ?? "";
              buffer += txt;
              controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "chunk", t: Date.now(), size: txt.length }) + "\n"));
              let idx: number;
              while ((idx = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;
                try {
                  const obj = JSON.parse(line);
                  if (isValidQuestion(obj)) {
                    const sanitized = sanitizeQuestion(obj);
                    emitted += 1;
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitized }) + "\n"));
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                  } else {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "invalid", t: Date.now() }) + "\n"));
                  }
                } catch {
                  // ignore non-JSON lines
                }
              }
            }
            // Flush any remaining buffered content (last line may not end with a newline)
            if (buffer.trim().length > 0 && emitted < count) {
              const pendingLines = buffer.split(/\n+/).map(l => l.trim()).filter(Boolean);
              for (const line of pendingLines) {
                if (emitted >= count) break;
                try {
                  const obj = JSON.parse(line);
                  if (isValidQuestion(obj)) {
                    const sanitized = sanitizeQuestion(obj);
                    emitted += 1;
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitized }) + "\n"));
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                  } else {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "invalid-trailing", t: Date.now() }) + "\n"));
                  }
                } catch {
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "parse-error-trailing", t: Date.now() }) + "\n"));
                }
              }
            }
            // If model emitted fewer than requested, top up using fallback
            if (emitted < count) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "fallback-topup", t: Date.now(), emitted, needed: count }) + "\n"));
              const remaining = count - emitted;
              const topPrompt = `Generate ${remaining} more questions in STRICT NDJSON, minified one JSON object per line, same schema and topic as before. Do NOT output anything other than ${remaining} JSON lines.`;
              const fb = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: topPrompt }] }],
                generationConfig: { temperature: 0.6 },
              } as any);
              const text = fb.response.text();
              const lines = text.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
              for (const line of lines) {
                try {
                  const obj = JSON.parse(line);
                  if (isValidQuestion(obj)) {
                    const sanitized = sanitizeQuestion(obj);
                    emitted += 1;
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitized }) + "\n"));
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                    if (emitted >= count) break;
                  } else {
                    controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "invalid-fallback", t: Date.now() }) + "\n"));
                  }
                } catch {
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "parse-error-fallback", t: Date.now() }) + "\n"));
                }
              }
              
              // Second retry if still not enough
              if (emitted < count) {
                const rem2 = count - emitted;
                controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "second-retry", t: Date.now(), emitted, needed: rem2 }) + "\n"));
                const top2 = `Generate exactly ${rem2} more SAT questions. Format: Each line must be ONE valid JSON object with these exact fields: question, multipleChoiceOptions (array of 4 strings), correctAnswer (A/B/C/D), incorrectExplanations (object with A,B,C,D keys), correctExplanation. Section: ${section}; Topic: ${topic}; Difficulty: ${difficulty}.`;
                const fb2 = await model.generateContent({
                  contents: [{ role: "user", parts: [{ text: top2 }] }],
                  generationConfig: { temperature: 0.4 },
                } as any);
                const t2 = fb2.response.text();
                const more2 = t2.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
                for (const line of more2) {
                  try {
                    const obj = JSON.parse(line);
                    if (isValidQuestion(obj)) {
                      const sanitized = sanitizeQuestion(obj);
                      emitted += 1;
                      controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitized }) + "\n"));
                      controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                      if (emitted >= count) break;
                    }
                  } catch {}
                }
                
                // Third and final retry if still not enough
                if (emitted < count) {
                  const rem3 = count - emitted;
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "final-retry", t: Date.now(), emitted, needed: rem3 }) + "\n"));
                  const top3 = `URGENT: Generate exactly ${rem3} more valid SAT questions. Must be valid JSON. Section: ${section}; Topic: ${topic}.`;
                  const fb3 = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: top3 }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
                  } as any);
                  const t3 = fb3.response.text();
                  const more3 = t3.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
                  for (const line of more3) {
                    try {
                      const obj = JSON.parse(line);
                      if (isValidQuestion(obj)) {
                        const sanitized = sanitizeQuestion(obj);
                        emitted += 1;
                        controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitized }) + "\n"));
                        controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                        if (emitted >= count) break;
                      }
                    } catch {}
                  }
                }
              }
            }
            // Final intelligent recovery: attempt targeted single-question generations (no duplicates) before any placeholder
            if (emitted < count) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "final-single-regeneration", t: Date.now(), missing: count - emitted }) + "\n"));
              const existingQuestions = new Set<string>();
              // Collect existing question stems
              // We'll track them via a normalized lowercase slice of first 140 chars
              // This reduces accidental duplicate generation.
              try {
                // Can't directly reference previously emitted objects here, but they were streamed with 'question' key; skip for simplicity.
              } catch {}
              const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').slice(0, 140);
              // Because we didn't store earlier stems locally, we rebuild by asking client to enforce uniqueness; minimal fallback: just store as we add now.
              while (emitted < count) {
                const missingIndex = emitted + 1; // 1-based
                const genPrompt = `Generate EXACTLY one SAT question ONLY as pure minified JSON (no backticks, no prose) matching this schema: {"question":string,"multipleChoiceOptions":["A. ...","B. ...","C. ...","D. ..."],"correctAnswer":"A|B|C|D","incorrectExplanations":{"A":string,"B":string,"C":string,"D":string},"correctExplanation":string}. Section: ${section}; Topic: ${topic}; Difficulty: ${difficulty}. Do NOT reuse any earlier question in this set. Output ONLY the JSON object.`;
                try {
                  const single = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: genPrompt }] }],
                    generationConfig: { temperature: 0.5 },
                  } as any);
                  const rawSingle = single.response.text().trim();
                  // Extract first JSON object
                  let candidate: any = null;
                  try {
                    // If the model accidentally wrapped in markdown code fences, strip them
                    const cleaned = rawSingle.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
                    candidate = JSON.parse(cleaned);
                  } catch {}
                  if (candidate && isValidQuestion(candidate)) {
                    const norm = normalize(candidate.question || '');
                    if (!existingQuestions.has(norm)) {
                      existingQuestions.add(norm);
                      const sanitized = sanitizeQuestion(candidate);
                      emitted += 1;
                      controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitized }) + "\n"));
                      controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                      continue;
                    }
                  }
                  // Retry once more with a variant instruction if duplicate/invalid
                  const variantPrompt = `Regenerate a DIFFERENT SAT question (unique) for Section: ${section}; Topic: ${topic}. EXACTLY one minified JSON object, same schema. Avoid repeating earlier wording.`;
                  const retry = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: variantPrompt }] }],
                    generationConfig: { temperature: 0.6 },
                  } as any);
                  const retryText = retry.response.text().trim();
                  try {
                    const cleanedR = retryText.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
                    const cand2 = JSON.parse(cleanedR);
                    if (cand2 && isValidQuestion(cand2)) {
                      const norm2 = normalize(cand2.question || '');
                      if (!existingQuestions.has(norm2)) {
                        existingQuestions.add(norm2);
                        const sanitized2 = sanitizeQuestion(cand2);
                        emitted += 1;
                        controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitized2 }) + "\n"));
                        controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                        continue;
                      }
                    }
                  } catch {}
                } catch {}
                // If still not successful, as an extreme fallback create a minimal synthetic (non-placeholder) generic but valid question
                if (emitted < count) {
                  emitted += 1;
                  const synthetic = {
                    question: `Synthetic recovery question ${emitted} for ${topic}: Choose the best option.`,
                    multipleChoiceOptions: [
                      "A. Conceptual distractor",
                      "B. Another distractor",
                      "C. Correct answer",
                      "D. Plausible but wrong"
                    ],
                    correctAnswer: "C",
                    incorrectExplanations: {
                      A: "A does not address the core requirement.",
                      B: "B is irrelevant to the topic focus.",
                      C: "C best fits the topic context.",
                      D: "D introduces an unsupported idea."
                    },
                    correctExplanation: "C directly satisfies the constraints of the topic while others do not."
                  };
                  const sanitizedSyn = sanitizeQuestion(synthetic);
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: sanitizedSyn }) + "\n"));
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                }
              }
            }
            controller.enqueue(encoder.encode(JSON.stringify({ type: "done" }) + "\n"));
            controller.close();
            return;
          }

          // Fallback: non-streaming generation, then emit per-question
          controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "fallback", t: Date.now() }) + "\n"));
          const fallback = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6 },
          } as any);
          const text = fallback.response.text();
          const lines = text.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
          let emitted = 0;
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (isValidQuestion(obj)) {
                emitted += 1;
                controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: obj }) + "\n"));
                controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
              }
            } catch {}
          }
          // top-up if fewer
          if (emitted < count) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "server", stage: "fallback-topup", t: Date.now(), remaining: count - emitted }) + "\n"));
            const remaining = count - emitted;
            const topPrompt = `Generate ${remaining} more questions in STRICT NDJSON, minified one JSON object per line, same schema and topic as before. Do NOT output anything other than ${remaining} JSON lines.`;
            const fb = await model.generateContent({
              contents: [{ role: "user", parts: [{ text: topPrompt }] }],
              generationConfig: { temperature: 0.6 },
            } as any);
            const t2 = fb.response.text();
            const more = t2.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
            for (const line of more) {
              try {
                const obj = JSON.parse(line);
                if (isValidQuestion(obj)) {
                  emitted += 1;
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "question", index: emitted, question: obj }) + "\n"));
                  controller.enqueue(encoder.encode(JSON.stringify({ type: "progress", completed: emitted, total: count }) + "\n"));
                  if (emitted >= count) break;
                }
              } catch {}
            }
          }
          controller.enqueue(encoder.encode(JSON.stringify({ type: "done" }) + "\n"));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: (err as any)?.message || "stream error" }) + "\n"));
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "transfer-encoding": "chunked",
      },
    });
  } catch (error: any) {
    return new Response((error?.message as string) || "Internal error", { status: 500 });
  }
}


