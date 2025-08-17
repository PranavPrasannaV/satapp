import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/** AI Coach endpoint: diagnoses a single missed question using structured analysis flow */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "";
    if (!apiKey) return new Response(JSON.stringify({ error: "Missing GOOGLE_API_KEY" }), { status: 500 });
    const body = await req.json();
    const section = String(body.section || '').slice(0,100);
    const topic = String(body.topic || '').slice(0,200);
    const question = String(body.question || '').slice(0,8000);
  const studentAnswer = String(body.studentAnswer || '').toUpperCase().replace(/[^A-D]/g,'');
    if (!question) return new Response(JSON.stringify({ error: 'Missing question' }), { status: 400 });

    // Attempt to extract the text of the chosen (incorrect) answer from the raw question
    let chosenText = '';
    if (studentAnswer) {
      const letter = studentAnswer.charAt(0);
      const choiceRegex = new RegExp(`(?:^|\\n)\\s*(?:${letter}[\\).:]\\s*)([^\\n]{1,160})`, 'i');
      const m = choiceRegex.exec(question);
      if (m) chosenText = m[1].trim();
    }
    const chosenLine = studentAnswer ? `Student selected answer (incorrect): ${studentAnswer}${chosenText ? ` — ${chosenText}` : ''}` : 'Student selected answer: (not recorded)';

  const prompt = `Role: You are an SAT coach and pattern analyst who diagnoses mistakes with precision and gives a targeted improvement plan. Respond ONLY with strict JSON (utf-8) matching the schema below. No markdown, no code fences, no extra commentary. If uncertain about any field, still include the field with a best-effort value (never null, never omit). Escape internal quotes properly.\n\nQUESTION (user got wrong):\n${question}\n\n${chosenLine}\nSection: ${section || '(unknown)'}\nTopic: ${topic || '(unknown)'}\n\nREQUIRED JSON SCHEMA (keys + descriptions):\n{\n  "correctAnswer": "Single letter A-D you judge correct (uppercase)",\n  "correctAnswerText": "Exact word/phrase of correct answer if identifiable else empty string",\n  "studentAnswer": "Student's chosen letter A-D or empty string if unknown",\n  "whatTested": {\n    "concept": "Precise concept/skill name (e.g., Vocabulary in Context, Linear Functions Slope)",\n    "difficulty": "Easy | Medium | Hard",\n    "summary": "1-2 sentence distilled statement of what was being tested"\n  },\n  "whyWrong": {\n    "missedIdea": "Exact idea/rule/logic the student failed to apply",\n    "trapType": "Named trap type if applicable else empty string",\n    "whyStudentAnswerAttractive": "One-sentence rationale for why their chosen option seemed plausible",\n    "otherOptions": [ { "option": "A", "issue": "Why A is wrong" }, { "option": "C", "issue": "..." } ]\n  },\n  "whyCorrect": {\n    "reasoning": "1-3 sentences: decisive reasoning proving correctness (no fluff)"\n  },\n  "gameplan": [ "Each bullet: actionable correction or drill (3-5 items)" ]\n}\n\nCONSTRAINTS:\n- Return ONLY valid JSON.\n- Do NOT wrap in backticks or add explanations.\n- All arrays must exist (even if empty).\n- All strings must be trimmed, no leading numbering or headings.\n- Keep bullets concise (max ~110 chars).\n- If any 'otherOptions' item would duplicate the correct or student answer rationale, still include but keep issue concise.\n\nProduce the JSON now.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 10000 }
    } as any);
    let raw = result.response.text().trim();
    // Attempt to isolate JSON (strip code fences if model ignored instructions)
    raw = raw.replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
    // Fallback: extract first JSON object using brace balance
    function extractFirstJson(s: string): string | null {
      const start = s.indexOf('{'); if (start === -1) return null;
      let depth = 0; for (let i=start;i<s.length;i++){ const ch=s[i]; if(ch==='{' ) depth++; else if(ch==='}') { depth--; if(depth===0) return s.slice(start,i+1); } }
      return null;
    }
    let jsonText = raw;
    if (!jsonText.startsWith('{')) {
      const extracted = extractFirstJson(raw);
      if (extracted) jsonText = extracted;
    }
    let structured: any = null; let parseError: string | null = null;
    try { structured = JSON.parse(jsonText); } catch(e:any) { parseError = e.message; }
    // Basic schema enforcement / sanitization
    function str(v:any){ return (typeof v === 'string' ? v : (v==null?'' : String(v))).trim(); }
    if (structured && typeof structured === 'object') {
      structured.correctAnswer = str(structured.correctAnswer).toUpperCase().replace(/[^A-D]/g,'').slice(0,1);
      structured.correctAnswerText = str(structured.correctAnswerText).slice(0,120);
      structured.studentAnswer = str(structured.studentAnswer).toUpperCase().replace(/[^A-D]/g,'').slice(0,1);
      const wt = structured.whatTested || {}; structured.whatTested = {
        concept: str(wt.concept).slice(0,80),
        difficulty: /^(easy|medium|hard)$/i.test(str(wt.difficulty)) ? str(wt.difficulty)[0].toUpperCase()+str(wt.difficulty).slice(1).toLowerCase() : 'Medium',
        summary: str(wt.summary).slice(0,300)
      };
      const ww = structured.whyWrong || {}; structured.whyWrong = {
        missedIdea: str(ww.missedIdea).slice(0,300),
        trapType: str(ww.trapType).slice(0,80),
        whyStudentAnswerAttractive: str(ww.whyStudentAnswerAttractive).slice(0,200),
        otherOptions: Array.isArray(ww.otherOptions) ? ww.otherOptions.filter((o:any)=>o&&typeof o==='object').map((o:any)=>({ option: str(o.option).toUpperCase().replace(/[^A-D]/g,'').slice(0,1), issue: str(o.issue).slice(0,160) })).slice(0,4) : []
      };
      const wc = structured.whyCorrect || {}; structured.whyCorrect = { reasoning: str(wc.reasoning).slice(0,400) };
      structured.gameplan = Array.isArray(structured.gameplan) ? structured.gameplan.map((b:any)=>str(b).slice(0,140)).filter((b:string)=>b).slice(0,6) : [];
    }
    const payload = structured ? { structured, raw: structured.whyCorrect?.reasoning || '' } : { raw, error: parseError || 'Failed to parse JSON' };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.error('/api/learn/coach error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
}
