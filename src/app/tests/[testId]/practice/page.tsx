"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type GeneratedQuestion = {
  question: string;
  multipleChoiceOptions: string[]; // ["A. ...", "B. ...", ...]
  correctAnswer: "A" | "B" | "C" | "D";
  incorrectExplanations: Record<"A" | "B" | "C" | "D", string>;
  correctExplanation: string;
};

// Parse pasted question text to extract stem and choices (A-D), and remove noisy prefixes like
// "Question 3", "Answers", "Prompt". Supports label formats: A., A), (A), A:
function parseQuestionText(raw: string): { stem: string; choices: { label: string; text: string }[] } {
  if (!raw) return { stem: "", choices: [] };
  let text = raw
    .replace(/\u2022/g, "•") // normalize bullets
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
  // Remove noisy tokens but avoid gobbling the rest of the line
  text = text
    .replace(/\bquestion\s*\d+\b/gi, "")
    .replace(/\b(prompt|answers?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Find positions of A/B/C/D in multiple formats
  const labels = ["A", "B", "C", "D"] as const;
  const indices: { label: string; idx: number }[] = [];
  labels.forEach((lab) => {
    // Accept A., A), (A), A:
    const r = new RegExp(`(?:\\b|\n|\r|\\s)(?:\\(${lab}\\)|${lab}\\)|${lab}\\.|${lab}:)`, "i");
    const m = r.exec(text);
    if (m && m.index >= 0) indices.push({ label: `${lab}.`, idx: m.index });
  });

  // If less than 2 labels found, consider no structured choices
  if (indices.length < 2) return { stem: text, choices: [] };

  // Sort by index
  indices.sort((a, b) => a.idx - b.idx);
  const firstIdx = indices[0].idx;
  const stem = text.slice(0, firstIdx).replace(/\s*•+\s*$/g, "").trim();

  const segments: { label: string; text: string }[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].idx;
    const end = i + 1 < indices.length ? indices[i + 1].idx : text.length;
    let seg = text.slice(start, end).trim();
    // Remove leading label from seg (supporting multiple formats)
    const labLetter = indices[i].label[0];
    // Build regex pattern safely by concatenating strings to avoid template literal issues
    const pattern = `^(?:\\(${labLetter}\\)|${labLetter}\\)|${labLetter}\\.|${labLetter}:)` + '\\s*';
    seg = seg
      .replace(new RegExp(pattern, "i"), "")
      .trim();
    // Remove leading bullets if any
    seg = seg.replace(/^•\s*/g, "").trim();
    segments.push({ label: indices[i].label, text: seg });
  }
  return { stem: stem || raw.trim(), choices: segments };
}

export default function PracticePage() {
  const params = useParams();
  const router = useRouter();
  const sp = useSearchParams();
  const testId = params.testId as string;
  const section = sp.get("section") || "";
  const topic = sp.get("topic") || "";
  const regen = sp.get("regen") || "";
  const keyParam = sp.get("key") || "";
  const quizIdParam = sp.get("quizId") || ""; // Support quizId parameter

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [genCount, setGenCount] = useState(0);
  const [genTotal, setGenTotal] = useState(10);
  const [warmup, setWarmup] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  // Debug generation workflow UI removed per request; logging stripped out.

  const sessionKey = useMemo(() => {
    return `sat-practice-session-${testId}-${encodeURIComponent(section)}-${encodeURIComponent(topic)}`;
  }, [testId, section, topic]);
  const [activeSessionKey, setActiveSessionKey] = useState<string>(sessionKey);
  const [fallbackMeta, setFallbackMeta] = useState<{ section?: string; topic?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        // If a specific session key is provided, load it directly
        if (keyParam) {
          try {
            const raw = localStorage.getItem(keyParam);
            if (raw) {
              const parsed = JSON.parse(raw) as { questions?: GeneratedQuestion[]; answers?: Record<number, string>; section?: string; topic?: string };
              if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
                setQuestions(parsed.questions);
                if (parsed.answers) setAnswers(parsed.answers);
                if (typeof (parsed as any).currentIdx === 'number') {
                  setCurrentIdx(Math.max(0, Math.min(parsed.questions.length - 1, (parsed as any).currentIdx)));
                }
                if ((parsed as any).isCompleted) setSessionCompleted(true);
                setFallbackMeta({ section: parsed.section, topic: parsed.topic });
                setActiveSessionKey(keyParam);
                setLoading(false);
                return;
              }
            }
          } catch {}
        }

        // If a specific quiz ID is provided, load it directly
        if (quizIdParam) {
          try {
            const raw = localStorage.getItem(quizIdParam);
            if (raw) {
              const parsed = JSON.parse(raw) as { questions?: GeneratedQuestion[]; answers?: Record<number, string>; section?: string; topic?: string };
              if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
                setQuestions(parsed.questions);
                if (parsed.answers) setAnswers(parsed.answers);
                if (typeof (parsed as any).currentIdx === 'number') {
                  setCurrentIdx(Math.max(0, Math.min(parsed.questions.length - 1, (parsed as any).currentIdx)));
                }
                if ((parsed as any).isCompleted) setSessionCompleted(true);
                setFallbackMeta({ section: parsed.section, topic: parsed.topic });
                setActiveSessionKey(quizIdParam);
                setLoading(false);
                return;
              }
            }
            // Fallback: search quiz history record (sat-ai-quizzes-v1) by id
            try {
              const histRaw = localStorage.getItem('sat-ai-quizzes-v1');
              if (histRaw) {
                const arr = JSON.parse(histRaw);
                if (Array.isArray(arr)) {
                  const rec = arr.find((q: any) => q && (q.id === quizIdParam || q.sessionKey === quizIdParam));
                  if (rec && Array.isArray(rec.questions) && rec.questions.length > 0) {
                    setQuestions(rec.questions);
                    if (rec.answers) setAnswers(rec.answers);
                    setFallbackMeta({ section: rec.section, topic: rec.topic });
                    if (rec.sessionKey) setActiveSessionKey(rec.sessionKey); else setActiveSessionKey(quizIdParam);
                    if (rec.isCompleted || rec.completedAt) setSessionCompleted(true);
                    setLoading(false);
                    return;
                  }
                }
              }
            } catch {}
          } catch {}
        }

        // If we already have a saved session and not regenerating, load it and skip generation
        try {
          const existing = localStorage.getItem(sessionKey);
          if (existing && regen !== '1') {
            const parsed = JSON.parse(existing) as { questions?: GeneratedQuestion[]; answers?: Record<number, string>; section?: string; topic?: string };
            if (!cancelled && parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
              setQuestions(parsed.questions);
              if (parsed.answers) setAnswers(parsed.answers);
              if (typeof (parsed as any).currentIdx === 'number') {
                setCurrentIdx(Math.max(0, Math.min(parsed.questions.length - 1, (parsed as any).currentIdx)));
              }
              if ((parsed as any).isCompleted) setSessionCompleted(true);
              setFallbackMeta({ section: parsed.section, topic: parsed.topic });
              setActiveSessionKey(sessionKey);
              setLoading(false);
              return; // Skip generation
            }
          }
        } catch {}

        // Try resuming the most recent session for this test regardless of section/topic
        let latestKey: string | null = null;
        let latestMeta: { section?: string; topic?: string } = {};
        try {
          const prefix = `sat-practice-session-${testId}-`;
          let newest = 0;
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i) || "";
            if (!k.startsWith(prefix)) continue;
            const raw = localStorage.getItem(k);
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              const updatedAt = Number(parsed?.updatedAt || 0);
              const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
              if (qs.length === 0) continue;
              if (updatedAt > newest) {
                newest = updatedAt;
                latestKey = k;
                latestMeta = { section: parsed?.section, topic: parsed?.topic };
              }
            } catch {}
          }
          if (latestKey && regen !== '1') {
            const raw = localStorage.getItem(latestKey);
            if (raw) {
              const parsed = JSON.parse(raw) as { questions?: GeneratedQuestion[]; answers?: Record<number, string> };
              if (!cancelled && parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
                setQuestions(parsed.questions);
                if (parsed.answers) setAnswers(parsed.answers);
                if (typeof (parsed as any).currentIdx === 'number') {
                  setCurrentIdx(Math.max(0, Math.min(parsed.questions.length - 1, (parsed as any).currentIdx)));
                }
                if ((parsed as any).isCompleted) setSessionCompleted(true);
                setFallbackMeta(latestMeta);
                setActiveSessionKey(latestKey);
                setLoading(false);
                return; // Resume latest
              }
            }
          }
        } catch {}

        setLoading(true);
        setGenCount(0);
        setGenTotal(10);
        setWarmup(false);
  // (debug events reset removed)
        const warmupTimer = window.setTimeout(() => {
          if (!cancelled && genCount === 0) setWarmup(true);
        }, 700);
        // Determine inputs to generate with
        let genSection = section || latestMeta.section || fallbackMeta.section || "";
        let genTopic = topic || latestMeta.topic || fallbackMeta.topic || "";
        if (!genSection || !genTopic) {
          // Try deriving from cached analysis for this test (pick top topic)
          try {
            const raw = localStorage.getItem("sat-analysis-v1");
            if (raw) {
              const map = JSON.parse(raw) as Record<string, { groups?: Array<{ question: string[]; section: string; topic: string }> }>;
              const entry = map?.[testId];
              const groups = Array.isArray(entry?.groups) ? entry?.groups : [];
              if (groups.length > 0) {
                const top = [...groups].sort((a, b) => (b.question?.length || 0) - (a.question?.length || 0))[0];
                genSection = top?.section || genSection;
                genTopic = top?.topic || genTopic;
              }
            }
          } catch {}
        }
        if (!genSection || !genTopic) {
          setError("Missing section or topic");
          setLoading(false);
          return;
        }

        // Determine difficulty tier from local storage (adaptive)
        let difficulty = "" as any;
        try {
          const mapRaw = localStorage.getItem("sat-topic-difficulty-v1");
          const store = mapRaw ? JSON.parse(mapRaw) as Record<string, any> : {};
          const rec = store[testId]?.[`${genSection}::${genTopic}`];
          if (rec?.tier) difficulty = rec.tier;
        } catch {}

        // Load recent mistakes for this topic from cached analysis
        let recentMistakes: string[] = [];
        try {
          const raw = localStorage.getItem("sat-analysis-v1");
          if (raw) {
            const map = JSON.parse(raw) as Record<string, { signature: string; groups: Array<{ question: string[]; section: string; topic: string }>; savedAt: number }>;
            const cached = map?.[testId];
            if (cached && Array.isArray(cached.groups)) {
              cached.groups.forEach((g) => {
                if (String(g.section).toLowerCase().startsWith(String(genSection).toLowerCase().slice(0, 4)) && String(g.topic).toLowerCase() === String(genTopic).toLowerCase()) {
                  if (Array.isArray(g.question)) recentMistakes.push(...g.question.filter(Boolean));
                }
              });
            }
          }
        } catch {}
        // Debug: log start once inputs are resolved
  // (debug log removed)

        const res = await fetch("/api/generate/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section: genSection, topic: genTopic, count: 10, recentMistakes, difficulty }),
        });
        if (!res.ok || !res.body) {
          const err = await res.text().catch(() => "");
          throw new Error(err || `Failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const genKey = `sat-practice-session-${testId}-${encodeURIComponent(genSection)}-${encodeURIComponent(genTopic)}`;
        setActiveSessionKey(genKey);
        setFallbackMeta({ section: genSection, topic: genTopic });
        const built: any[] = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            try {
              const msg = JSON.parse(line);
              // (debug log removed)
              if (msg.type === 'server') {
                // server event handling kept minimal; no UI display
              }
              if (msg.type === "question" && msg.question) {
                const i = (msg.index as number) - 1;
                if (i >= 0) built[i] = msg.question;
                setGenCount((c) => Math.max(c, msg.index || c));
                if (warmup) setWarmup(false);
                // (debug preview removed)
              } else if (msg.type === "progress") {
                if (typeof msg.completed === 'number') setGenCount(msg.completed);
                if (typeof msg.total === 'number') setGenTotal(msg.total);
                if ((msg.completed || 0) > 0 && warmup) setWarmup(false);
              } else if (msg.type === "done") {
                // finalize (debug log removed)
              }
            } catch {}
          }
        }
        if (!cancelled) {
          const qs = built.filter(Boolean);
          setQuestions(qs as any);
          setAnswers({});
          setSessionCompleted(false);
          // Persist under stable sessionKey so we can resume if user leaves mid-quiz
          const stableKey = `sat-practice-session-${testId}-${encodeURIComponent(genSection)}-${encodeURIComponent(genTopic)}`;
          setActiveSessionKey(stableKey);
          try {
            localStorage.setItem(stableKey, JSON.stringify({
              questions: qs,
              answers: {},
              currentIdx: 0,
              testId,
              section: genSection,
              topic: genTopic,
              updatedAt: Date.now(),
              quizId: stableKey,
              isCompleted: false
            }));
          } catch {}
        }
        window.clearTimeout(warmupTimer);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load questions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section, topic, regen, sessionKey, testId, keyParam, quizIdParam]);

  // No separate loader; handled in the generation effect above

  // Persist answers as the user selects
  useEffect(() => {
    if (!activeSessionKey || questions.length === 0) return;
    try {
      const raw = localStorage.getItem(activeSessionKey);
      const base = raw ? JSON.parse(raw) : {};
      const payload = { 
        ...base, 
        questions, 
        answers, 
        currentIdx, 
        testId, 
        section: base.section || section || fallbackMeta.section, 
        topic: base.topic || topic || fallbackMeta.topic, 
        updatedAt: Date.now(),
        quizId: activeSessionKey,
        isCompleted: base.isCompleted || false
      };
      localStorage.setItem(activeSessionKey, JSON.stringify(payload));
    } catch {}
  }, [answers, questions, currentIdx, activeSessionKey, testId, section, topic, fallbackMeta.section, fallbackMeta.topic]);

  const allAnswered = useMemo(() => {
    return questions.length > 0 && questions.every((q, idx) => {
      // Check if this question is valid
      let isValid = false;
      
      // First try to use multipleChoiceOptions
      if (Array.isArray((q as any).multipleChoiceOptions) && (q as any).multipleChoiceOptions.length >= 4) {
        isValid = true;
      } else {
        // Fallback: try parsing from question text
        try {
          const parsed = parseQuestionText(q.question || "");
          isValid = parsed.choices && parsed.choices.length >= 4;
        } catch {}
      }
      
      // If question is invalid, consider it "answered" (skippable)
      // If question is valid, check if it has an answer
      return !isValid || !!answers[idx];
    });
  }, [questions, answers]);

  const current = questions[currentIdx];
  const selectedForCurrent = answers[currentIdx];

  // Helper function to check if current question is valid (has 4 multiple choice options)
  function isCurrentQuestionValid() {
    if (!current) return false;
    
    // First try to use multipleChoiceOptions
    if (Array.isArray((current as any).multipleChoiceOptions) && (current as any).multipleChoiceOptions.length >= 4) {
      return true;
    }
    
    // Fallback: try parsing from question text
    try {
      const parsed = parseQuestionText(current.question || "");
      return parsed.choices && parsed.choices.length >= 4;
    } catch {
      return false;
    }
  }

  // Helper function to check if we can proceed to next question
  function canProceedNext() {
    // If question is invalid, always allow proceeding (skip)
    if (!isCurrentQuestionValid()) return true;
    // If question is valid, require an answer
    return !!selectedForCurrent;
  }

  function goNext() {
    if (currentIdx + 1 < questions.length) {
      setCurrentIdx((i) => i + 1);
      return;
    }
    // Last question: if already completed (state) navigate to summary
    if (sessionCompleted) {
      const secParam = encodeURIComponent(section || fallbackMeta.section || "");
      const topParam = encodeURIComponent(topic || fallbackMeta.topic || "");
      const quizIdParam = encodeURIComponent(activeSessionKey);
      router.push(`/tests/${testId}/practice/review?section=${secParam}&topic=${topParam}&quizId=${quizIdParam}`);
      return;
    }
    // Also check persisted session flag to avoid duplicate completion (covers case state not yet set)
    try {
      const raw = localStorage.getItem(activeSessionKey);
      if (raw) {
        const existing = JSON.parse(raw);
        if (existing && existing.isCompleted) {
          setSessionCompleted(true);
          const secParam = encodeURIComponent(section || fallbackMeta.section || "");
          const topParam = encodeURIComponent(topic || fallbackMeta.topic || "");
          const quizIdParam = encodeURIComponent(activeSessionKey);
          router.push(`/tests/${testId}/practice/review?section=${secParam}&topic=${topParam}&quizId=${quizIdParam}`);
          return;
        }
      }
    } catch {}

    // First completion: mark quiz as completed and go to review
    try {
      const raw = localStorage.getItem(activeSessionKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (!data.isCompleted) {
          data.isCompleted = true;
          data.completedAt = Date.now();
          localStorage.setItem(activeSessionKey, JSON.stringify(data));
        }
      }
    } catch {}
    setSessionCompleted(true);
    
    const secParam = encodeURIComponent(section || fallbackMeta.section || "");
    const topParam = encodeURIComponent(topic || fallbackMeta.topic || "");
    const quizIdParam = encodeURIComponent(activeSessionKey);
    router.push(`/tests/${testId}/practice/review?section=${secParam}&topic=${topParam}&quizId=${quizIdParam}`);
  }

  function goBack() {
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
      return;
    }
  // On first question: go back to Practice hub page (avoid setState callback to prevent Router update during render)
  router.push(`/tests/${testId}/learn`); // route path kept; only text changes elsewhere
  }

  return (
    <div className="space-y-6">
      <div className="card pop-enter">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link href={`/tests/${testId}/learn`} className="text-blue-500 hover:text-blue-700 mb-2 inline-block">← Back to Practice</Link>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Practice: {topic || fallbackMeta.topic || "Topic"}</h1>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">Section: {section || fallbackMeta.section || "-"} · 10 questions</p>
          </div>
          <div className="text-sm text-black/60 dark:text-white/60">{loading ? 'Generating question set…' : (questions.length > 0 ? `${Object.keys(answers).length}/${questions.length} answered` : "")}</div>
        </div>
      </div>

      <div className="card pop-enter">
        {loading ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between text-xs text-black/60 dark:text-white/60">
              <div className="flex-1 mr-3 flex gap-2">
                {Array.from({ length: 10 }).map((_, i) => {
                  const filled = i < Math.min(genCount, 10);
                  const isFirst = i === 0;
                  const cls = filled
                    ? 'bg-blue-400'
                    : (isFirst && warmup ? 'bg-blue-300/50 animate-pulse' : 'bg-black/20 dark:bg-white/15 animate-pulse');
                  return <div key={i} className={`h-1.5 flex-1 rounded-full ${cls}`} />;
                })}
              </div>
              <div className="text-xs">{Math.min(genCount, genTotal)} / {genTotal}</div>
            </div>
            <div className="rounded-md border border-black/10 dark:border-white/10 p-4">
              <div className="h-4 w-3/4 bg-black/10 dark:bg-white/10 rounded animate-pulse" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-10 rounded-md bg-black/10 dark:bg-white/10 animate-pulse" />
                ))}
              </div>
              <div className="mt-6 text-sm text-black/60 dark:text-white/60">Generating question set…</div>
            </div>

            {/* Generation workflow debug panel removed */}
          </div>
        ) : error ? (
          <div className="text-rose-600 dark:text-rose-400">{error}</div>
        ) : questions.length === 0 ? (
          <div className="text-sm text-black/60 dark:text-white/60">No questions generated.</div>
        ) : (
          <div className="space-y-6">
            {/* Progress bar */}
            <div className="flex items-center justify-between text-xs text-black/60 dark:text-white/60">
              <div className="flex-1 mr-3 flex gap-2">
                {questions.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${
                      i < currentIdx ? "bg-blue-500/70" : i === currentIdx ? "bg-blue-400" : "bg-black/20 dark:bg-white/15"
                    }`}
                  />
                ))}
              </div>
              <div>
                {currentIdx + 1} / {questions.length}
              </div>
            </div>

            {/* Single question card */}
            <div className="rounded-md border border-black/10 dark:border-white/10 p-4">
              <div className="font-medium mb-4">{currentIdx + 1}. {current.question}</div>
              
              {(() => {
                // Get options from current question
                let options: string[] = [];
                
                // First try to use multipleChoiceOptions
                if (Array.isArray((current as any).multipleChoiceOptions) && (current as any).multipleChoiceOptions.length >= 4) {
                  options = (current as any).multipleChoiceOptions as string[];
                } else {
                  // Fallback: try parsing from question text
                  try {
                    const parsed = parseQuestionText(current.question || "");
                    if (parsed.choices && parsed.choices.length >= 4) {
                      options = parsed.choices.map((c) => `${c.label} ${c.text}`);
                    }
                  } catch {}
                }
                
                // If we still don't have valid options, this question is invalid
                if (options.length < 4) {
                  return (
                    <div className="space-y-4">
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-4">
                        <div className="flex items-start gap-3">
                          <span className="inline-block h-5 w-5 bg-amber-500 rounded-full shrink-0 mt-0.5" />
                          <div>
                            <div className="font-medium text-amber-800 dark:text-amber-200">Invalid Question</div>
                            <div className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                              This question doesn't have valid multiple choice options. Skipping to the next question.
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button onClick={goBack} className="btn-outline">Back</button>
                        <button onClick={goNext} className="btn-gradient">
                          Skip Question
                        </button>
                      </div>
                    </div>
                  );
                }
                
                return (
                  <div className="grid gap-3">
                    {options.map((opt, j) => {
                      const letter = ("ABCD" as const)[j] as unknown as "A" | "B" | "C" | "D";
                      const hasAnswered = typeof selectedForCurrent !== "undefined" && selectedForCurrent !== undefined;
                      const isCorrect = letter === current.correctAnswer;
                      const isSelected = selectedForCurrent === letter;
                      const showFeedback = hasAnswered && (isSelected || (isCorrect && selectedForCurrent !== current.correctAnswer));

                      if (!hasAnswered) {
                        return (
                          <button
                            key={j}
                            onClick={() => setAnswers((prev) => ({ ...prev, [currentIdx]: letter }))}
                            className={`field text-left transition-all duration-200 hover:ring-2 hover:ring-blue-300/70`}
                          >
                            {opt}
                          </button>
                        );
                      }

                      return (
                        <div
                          key={j}
                          className={`rounded-md p-3 text-left transition-all duration-300 ${
                            isCorrect
                              ? "bg-emerald-500/10 border border-emerald-500/40 ring-1 ring-emerald-400/30"
                              : isSelected
                              ? "bg-rose-500/10 border border-rose-500/40 ring-1 ring-rose-400/30"
                              : "border border-black/10 dark:border-white/10 opacity-80"
                          }`}
                        >
                          <div className="font-medium">{opt}</div>
                          {showFeedback && (
                            <div className={`mt-3 text-sm rounded-md ${isCorrect ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${isCorrect ? "bg-emerald-500" : "bg-rose-500"}`} />
                                <span className="font-semibold">{isCorrect ? "Right answer" : "Not quite"}</span>
                              </div>
                              <div className="text-black/80 dark:text-white/80">
                                {isCorrect ? current.correctExplanation : (current.incorrectExplanations?.[letter] || "")}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Hint UI removed per request */}

              {/* Nav buttons */}
              <div className="mt-6 flex justify-end gap-2">
                <button onClick={goBack} className="btn-outline">Back</button>
                <button onClick={goNext} className="btn-gradient" disabled={!canProceedNext()}>
                  {currentIdx + 1 === questions.length
                    ? (sessionCompleted ? 'Review Summary' : (allAnswered ? 'Submit' : 'Review Summary'))
                    : 'Next'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


