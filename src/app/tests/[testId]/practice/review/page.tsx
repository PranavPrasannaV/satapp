"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type GeneratedQuestion = {
  question: string;
  multipleChoiceOptions: string[];
  correctAnswer: "A" | "B" | "C" | "D";
  incorrectExplanations: Record<"A" | "B" | "C" | "D", string>;
  correctExplanation: string;
};

const MISSED_STORAGE_KEY = "sat-missed-questions-v1";
const AI_STORAGE_KEY = "sat-ai-practice-bank-v1";
const AI_QUIZZES_KEY = "sat-ai-quizzes-v1";
const DIFFICULTY_KEY = "sat-topic-difficulty-v1";
const MASTERY_STORAGE_KEY = "sat-mastery-v1";

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const sp = useSearchParams();
  const testId = params.testId as string;
  const section = sp.get("section") || "";
  const topic = sp.get("topic") || "";
  const quizId = sp.get("quizId") || ""; // Get specific quiz ID

  const sessionKey = useMemo(() => {
    return `sat-practice-session-${testId}-${encodeURIComponent(section)}-${encodeURIComponent(topic)}`;
  }, [testId, section, topic]);
  const [activeKey, setActiveKey] = useState<string>(quizId || sessionKey);

  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    try {
      // First priority: Load specific quiz by ID if provided
      if (quizId) {
        // Attempt direct session key lookup
        const r = localStorage.getItem(quizId);
        if (r) {
          try {
            const parsed = JSON.parse(r);
            if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
              setQuestions(parsed.questions);
              if (parsed.answers) setAnswers(parsed.answers);
              // quizId param might be a sessionKey; keep it
              setActiveKey(quizId);
              return;
            }
          } catch {}
        }
        // Fallback: search quiz history store (sat-ai-quizzes-v1) by id
        try {
          const histRaw = localStorage.getItem(AI_QUIZZES_KEY);
          if (histRaw) {
            const arr = JSON.parse(histRaw) as any[];
            if (Array.isArray(arr)) {
              const rec = arr.find((q: any) => q && (q.id === quizId || q.sessionKey === quizId));
              if (rec && Array.isArray(rec.questions) && rec.questions.length > 0) {
                setQuestions(rec.questions);
                if (rec.answers) setAnswers(rec.answers);
                // Prefer the original sessionKey if present so future lookups work
                if (typeof rec.sessionKey === 'string' && rec.sessionKey) {
                  setActiveKey(rec.sessionKey);
                } else {
                  setActiveKey(quizId);
                }
                return;
              }
            }
          }
        } catch {}
      }

      // Second priority: Prefer exact URL key
      const raw = localStorage.getItem(sessionKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { questions?: GeneratedQuestion[]; answers?: Record<number, string> };
        if (Array.isArray(parsed.questions)) {
          setQuestions(parsed.questions);
          if (parsed.answers) setAnswers(parsed.answers);
          setActiveKey(sessionKey);
          return;
        }
      }

      // Fallback: latest session for this test
      const prefix = `sat-practice-session-${testId}-`;
      let latestKey: string | null = null;
      let newest = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || "";
        if (!k.startsWith(prefix)) continue;
        const r = localStorage.getItem(k);
        if (!r) continue;
        try {
          const p = JSON.parse(r);
          const upd = Number(p?.updatedAt || 0);
          if (Array.isArray(p?.questions) && p.questions.length > 0 && upd > newest) {
            newest = upd;
            latestKey = k;
          }
        } catch {}
      }
      if (latestKey) {
        const r = localStorage.getItem(latestKey);
        if (r) {
          const p = JSON.parse(r);
          setActiveKey(latestKey);
          setQuestions(p.questions || []);
          setAnswers(p.answers || {});
        }
      }
    } catch {}
  }, [sessionKey, testId, quizId]);

  const score = useMemo(() => {
    if (questions.length === 0) return { right: 0, wrong: 0, skipped: 0 };
    let right = 0, wrong = 0, skipped = 0;
    questions.forEach((q, idx) => {
      const a = answers[idx] as any;
      if (!a) skipped += 1; else if (a === q.correctAnswer) right += 1; else wrong += 1;
    });
    return { right, wrong, skipped };
  }, [questions, answers]);

  // Add wrong answers to AI bank on load (separate from user test misses)
  useEffect(() => {
    if (questions.length === 0) return;
    try {
      const existingRaw = localStorage.getItem(AI_STORAGE_KEY);
      const existing: any[] = existingRaw ? JSON.parse(existingRaw) : [];
      const toAdd = questions
        .map((q, idx) => ({ q, idx }))
        .filter(({ q, idx }) => answers[idx] && answers[idx] !== q.correctAnswer)
        .map(({ q }) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          section: section.startsWith("Math") ? (section as any) : (section as any) || "Reading",
          topic: q.question,
          source: `AI Practice: ${topic}`,
          questionNumber: undefined,
          tags: [],
          status: "Reviewing",
          testId: testId,
          originSessionKey: activeKey,
        }));
      if (toAdd.length > 0) {
        const deduped = [...toAdd, ...existing].reduce<any[]>((acc, cur) => {
          if (!acc.find((x) => x.topic === cur.topic && x.source === cur.source && x.testId === cur.testId)) acc.push(cur);
          return acc;
        }, []);
        localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(deduped));
      }
    } catch {}
  }, [questions, answers, section, topic, testId]);

  const accuracy = questions.length > 0 ? Math.round((score.right / questions.length) * 100) : 0;

  // Update mastery streaks and test mastery after each set
  useEffect(() => {
    if (!section || !topic || questions.length === 0) return;
    try {
      const raw = localStorage.getItem(MASTERY_STORAGE_KEY);
      const store = raw ? JSON.parse(raw) as Record<string, any> : {};
      const testRec = store[testId] || { topics: {}, testMastered: false };
      const key = `${section}::${topic}`;
      const prev = testRec.topics[key] || { topic, section, streak: 0, totalSets: 0, mastered: false, lastAccuracy: 0 };
      const passed = score.right >= 8 && questions.length >= 10;
      const nextStreak = passed ? (prev.streak || 0) + 1 : 0;
      const mastered = prev.mastered || nextStreak >= 5;
      const updated = {
        ...prev,
        streak: nextStreak,
        totalSets: (prev.totalSets || 0) + 1,
        mastered,
        lastAccuracy: accuracy,
        updatedAt: Date.now(),
      };
      testRec.topics[key] = updated;

      // Determine if the entire test is mastered: all analyzed topics mastered
      try {
        const analysisRaw = localStorage.getItem("sat-analysis-v1");
        const analysis = analysisRaw ? JSON.parse(analysisRaw) as Record<string, any> : {};
        const groups = Array.isArray(analysis?.[testId]?.groups) ? analysis[testId].groups as Array<{ section: string; topic: string }> : [];
        if (groups.length > 0) {
          const allMastered = groups.every((g) => {
            const k = `${g.section}::${g.topic}`;
            const rec = testRec.topics[k];
            return rec && rec.mastered;
          });
          testRec.testMastered = !!allMastered;
          if (allMastered) testRec.testMasteredAt = Date.now();
        }
      } catch {}

      store[testId] = testRec;
      localStorage.setItem(MASTERY_STORAGE_KEY, JSON.stringify(store));
    } catch {}
  }, [accuracy, score.right, questions.length, section, topic, testId]);

  // Persist this quiz run into AI quizzes history
  useEffect(() => {
    if (!activeKey || questions.length === 0) return;
    try {
      // Load the underlying session to pull its completedAt (if any)
      let sessionCompletedAt: number | undefined = undefined;
      try {
        const rawSession = localStorage.getItem(activeKey);
        if (rawSession) {
          const parsed = JSON.parse(rawSession);
            if (parsed && parsed.isCompleted && typeof parsed.completedAt === 'number') {
              sessionCompletedAt = parsed.completedAt;
            }
        }
      } catch {}
      // Only record when the session has actually been completed
      if (!sessionCompletedAt) return;
      const raw = localStorage.getItem(AI_QUIZZES_KEY);
      const arr = raw ? JSON.parse(raw) as any[] : [];
      // Deduplicate: same sessionKey + same completedAt timestamp already recorded
      const exists = arr.find((q: any) => q && q.sessionKey === activeKey && q.completedAt === sessionCompletedAt);
      if (exists) return;
      const rec = {
        id: `${sessionCompletedAt}-${Math.random().toString(36).substr(2, 6)}`,
        testId,
        section,
        topic,
        total: questions.length,
        right: score.right,
        wrong: score.wrong,
        skipped: score.skipped,
        accuracy,
        sessionKey: activeKey,
        questions,
        answers,
        savedAt: Date.now(),
        completedAt: sessionCompletedAt,
      };
      const updated = [rec, ...arr].slice(0, 200); // allow more history depth now
      localStorage.setItem(AI_QUIZZES_KEY, JSON.stringify(updated));
    } catch {}
  }, [activeKey, testId, section, topic, questions, answers, score.right, score.wrong, score.skipped, accuracy]);

  // Update adaptive difficulty for this topic based on performance
  useEffect(() => {
    if (!section || !topic || questions.length === 0) return;
    try {
      const mapRaw = localStorage.getItem(DIFFICULTY_KEY);
      const store = mapRaw ? JSON.parse(mapRaw) as Record<string, any> : {};
      const testRec = store[testId] || {};
      const key = `${section}::${topic}`;
      const current = (testRec[key]?.tier as string) || "Medium";
      const tiers = ["Easy", "Medium", "Hard", "Insane"] as const;
      const idx = Math.max(0, tiers.findIndex((t) => t === current));
      let next = current;
      if (accuracy >= 80) next = tiers[Math.min(tiers.length - 1, idx + 1)];
      else if (accuracy < 50) next = tiers[Math.max(0, idx - 1)];
      // 50-79 stays
      testRec[key] = { tier: next, lastAccuracy: accuracy, updatedAt: Date.now() };
      store[testId] = testRec;
      localStorage.setItem(DIFFICULTY_KEY, JSON.stringify(store));
    } catch {}
  }, [accuracy, section, topic, testId, questions.length]);

  return (
    <div className="space-y-6">
      <div className="card pop-enter">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">You Did It! Quiz Complete</h1>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card pop-enter">
          <div className="text-sm text-black/60 dark:text-white/60">Score</div>
          <div className="text-3xl font-semibold mt-2">{score.right}/{questions.length}</div>
        </div>
        <div className="card pop-enter">
          <div className="text-sm text-black/60 dark:text-white/60">Accuracy</div>
          <div className="text-3xl font-semibold mt-2">{accuracy}%</div>
        </div>
        <div className="card pop-enter">
          <div className="flex items-center justify-between">
            <div className="text-sm text-black/60 dark:text-white/60">Right</div>
            <div className="text-lg font-medium">{score.right}</div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="text-sm text-black/60 dark:text-white/60">Wrong</div>
            <div className="text-lg font-medium">{score.wrong}</div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="text-sm text-black/60 dark:text-white/60">Skipped</div>
            <div className="text-lg font-medium">{score.skipped}</div>
          </div>
        </div>
      </div>

      {/* CTA cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card pop-enter flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Flashcards</div>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">Create a complete set of flashcards from this quiz to reinforce key concepts.</p>
          </div>
          <button className="btn-gradient">Create flashcards</button>
        </div>
        <div className="card pop-enter flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Study guide</div>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">Generate a concise study guide based on your results for targeted review.</p>
          </div>
          <button className="btn-outline">Create study guide</button>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          className="btn-outline"
          onClick={() => router.push(`/tests/${testId}/learn`)}
        >
          Back to Practice
        </button>
        <button
          className="btn-outline"
          onClick={() => router.push(`/tests/${testId}/practice?section=${encodeURIComponent(section)}&topic=${encodeURIComponent(topic)}&regen=1`)}
        >
          Next set
        </button>
        <button
          className="btn-gradient"
          onClick={() => router.push(`/tests/${testId}/practice?quizId=${encodeURIComponent(activeKey)}&section=${encodeURIComponent(section)}&topic=${encodeURIComponent(topic)}`)}
        >
          View questions
        </button>
      </div>
    </div>
  );
}


