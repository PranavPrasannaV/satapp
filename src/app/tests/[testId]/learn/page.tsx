"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Section = "Reading" | "Math-Calculator" | "Math-No-Calculator";
type Status = "New" | "Reviewing" | "Mastered";

type MissedQuestion = {
  id: string;
  section: Section;
  topic: string;
  source: string;
  questionNumber?: number;
  tags: string[];
  status: Status;
  testId?: string;
};

interface PracticeTest {
  id: string;
  name: string;
  source: string;
  testNumber?: number;
  createdAt: string;
}

const STORAGE_KEY = "sat-missed-questions-v1";
const PRACTICE_TESTS_STORAGE_KEY = "sat-practice-tests-v1";
const ANALYSIS_STORAGE_KEY = "sat-analysis-v1";
const AI_QUIZZES_KEY = "sat-ai-quizzes-v1";

function parseQuestionText(raw: string): { stem: string; choices: { label: string; text: string }[] } {
  if (!raw) return { stem: "", choices: [] };
  let text = raw
    .replace(/\u2022/g, "•")
    .replace(/\s+/g, " ")
    .trim();
  text = text
    .replace(/\bquestion\s*\d+\b/gi, "")
    .replace(/\b(prompt|answers?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const labels = ["A", "B", "C", "D"] as const;
  const indices: { label: string; idx: number }[] = [];
  labels.forEach((lab) => {
    const r = new RegExp(`(?:\\b|\n|\r|\\s)(?:\\(${lab}\\)|${lab}\\)|${lab}\\.|${lab}:)`, "i");
    const m = r.exec(text);
    if (m && m.index >= 0) indices.push({ label: `${lab}.`, idx: m.index });
  });
  if (indices.length < 2) return { stem: text, choices: [] };
  indices.sort((a, b) => a.idx - b.idx);
  const firstIdx = indices[0].idx;
  const stem = text.slice(0, firstIdx).replace(/\s*•+\s*$/g, "").trim();
  const segments: { label: string; text: string }[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].idx;
    const end = i + 1 < indices.length ? indices[i + 1].idx : text.length;
    let seg = text.slice(start, end).trim();
    const labLetter = indices[i].label[0];
    const pattern = `^(?:\\(${labLetter}\\)|${labLetter}\\)|${labLetter}\\.|${labLetter}:)` + '\\s*';
    seg = seg.replace(new RegExp(pattern, "i"), "").trim();
    seg = seg.replace(/^•\s*/g, "").trim();
    segments.push({ label: indices[i].label, text: seg });
  }
  return { stem: stem || raw.trim(), choices: segments };
}

export default function LearnPage() { // component name retained for routing; UI text changed
  const params = useParams();
  const router = useRouter();
  const testId = params.testId as string;
  // Get section/topic from query string
  const [section, setSection] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      setSection(url.searchParams.get('section'));
      setTopic(url.searchParams.get('topic'));
    }
  }, []);

  const [test, setTest] = useState<PracticeTest | null>(null);
  const [items, setItems] = useState<MissedQuestion[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [grouped, setGrouped] = useState<Array<{ question: string[]; section: string; topic: string }>>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [aiBankCount, setAiBankCount] = useState(0);
  const [mastery, setMastery] = useState<{ testMastered: boolean; topics: Array<{ section: string; topic: string; streak: number; mastered: boolean; lastAccuracy: number }>}>({ testMastered: false, topics: [] });
  const [viewGroup, setViewGroup] = useState<{ section: string; topic: string; question: string[] } | null>(null);
  const [latestQuizzes, setLatestQuizzes] = useState<Record<string, { quizId: string; sessionKey: string; accuracy: number; right: number; total: number; savedAt: number }>>({});
  // Prevent infinite re-open when user closes the auto-opened group
  const [autoOpenSuppressed, setAutoOpenSuppressed] = useState(false);
  const lastParamKeyRef = useRef<string>("");
  // Dedicated learn modal state (separate styling / behavior from practice "View questions" modal)
  const [learnModal, setLearnModal] = useState<{ group: { section: string; topic: string; question: string[] } | null; idx: number }>({ group: null, idx: 0 });

  // Load test meta
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PRACTICE_TESTS_STORAGE_KEY);
      if (stored) {
        const tests: PracticeTest[] = JSON.parse(stored);
        const foundTest = tests.find((t) => t.id === testId);
        if (foundTest) {
          setTest(foundTest);
        } else {
          router.push("/");
        }
      } else {
        router.push("/");
      }
    } catch (error) {
      console.error("Error loading test:", error);
      router.push("/");
    }
  }, [testId, router]);

  // Load questions
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const array = Array.isArray(parsed) ? parsed : [];
        const migrated: MissedQuestion[] = array.map((q) => {
          const rec = q as Partial<MissedQuestion> & { tags?: unknown; testId?: unknown };
          return {
            id: String(rec.id ?? ""),
            section: (rec.section as Section) ?? "Reading",
            topic: String(rec.topic ?? ""),
            source: String(rec.source ?? ""),
            questionNumber: typeof rec.questionNumber === "number" ? rec.questionNumber : undefined,
            tags: Array.isArray(rec.tags) ? (rec.tags as string[]) : [],
            status: (rec.status as Status) ?? "New",
            testId: typeof rec.testId === "string" ? rec.testId : undefined,
          };
        });
        setItems(migrated);
      }
    } catch (error) {
      console.error("Error loading questions:", error);
    } finally {
      setItemsLoaded(true);
    }
  }, []);

  // Persist updates
  useEffect(() => {
    if (!itemsLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Error saving questions:", error);
    }
  }, [items, itemsLoaded]);

  // Filter queue: only questions for this test that are not mastered (ignore section/topic params here because item.topic holds raw question text)
  const queue = useMemo(() => {
    return items.filter((i) => i.testId === testId && i.status !== "Mastered");
  }, [items, testId]);

  useEffect(() => {
    if (currentIdx >= queue.length) setCurrentIdx(0);
  }, [queue.length, currentIdx]);

  function markMasteredAndAdvance() {
    const current = queue[currentIdx];
    if (!current) return;
    setItems((prev) => prev.map((q) => (q.id === current.id ? { ...q, status: "Mastered" } : q)));
    // Advance after state update; use length from latest queue via functional update
    setCurrentIdx((idx) => (idx + 1) % Math.max(1, queue.length));
  }

  function keepReviewingNext() {
    setCurrentIdx((idx) => (idx + 1 < queue.length ? idx + 1 : 0));
  }

  function hashString(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
  }

  // Call classifier when questions change (with caching by signature)
  useEffect(() => {
    const questionsForTest = items
      .filter((i) => i.testId === testId)
      .map((i) => `${i.id}|${i.section}|${i.status}|${i.topic}`)
      .filter(Boolean);
    if (questionsForTest.length === 0) {
      setGrouped([]);
      return;
    }
    const signature = hashString(questionsForTest.join("\n"));

    // Try cache first
    try {
      const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
      if (raw) {
        const map = JSON.parse(raw) as Record<string, { signature: string; groups: any; savedAt: number }>;
        const cached = map?.[testId];
        if (cached && cached.signature === signature && Array.isArray(cached.groups)) {
          setGrouped(cached.groups);
          setLoadingGroups(false);
          setGroupError(null);
          return; // Use cached and skip network
        }
      }
    } catch {}
    let cancelled = false;
    (async () => {
      try {
        setLoadingGroups(true);
        setGroupError(null);
        // Only send the raw question text to the API
        const rawQs = items.filter((i) => i.testId === testId).map((i) => i.topic).filter(Boolean);
        const res = await fetch('/api/format', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ questions: rawQs })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          const groups = Array.isArray(data.groups) ? data.groups : [];
          setGrouped(groups);
          // Save to cache
          try {
            const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
            const map = raw ? (JSON.parse(raw) as Record<string, any>) : {};
            map[testId] = { signature, groups, savedAt: Date.now() };
            localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(map));
          } catch {}
        }
      } catch (e: any) {
        if (!cancelled) setGroupError(e?.message || 'Failed to classify questions');
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();
    return () => { cancelled = true; };
  }, [items, testId]);

  // Derived: section split and topic counts from grouped output
  const sectionSplit = useMemo(() => {
    const reading = grouped.filter((g) => (g.section || '').toLowerCase().startsWith('read')).reduce((sum, g) => sum + (g.question?.length || 0), 0);
    const math = grouped.filter((g) => (g.section || '').toLowerCase().startsWith('math')).reduce((sum, g) => sum + (g.question?.length || 0), 0);
    return { reading, math };
  }, [grouped]);

  const topicsSorted = useMemo(() => {
    return [...grouped].sort((a, b) => (b.question?.length || 0) - (a.question?.length || 0));
  }, [grouped]);

  // Load AI bank count for this test
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sat-ai-practice-bank-v1");
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        const count = arr.filter((x: any) => x.testId === testId).length;
        setAiBankCount(count);
      }
    } catch {}
  }, [testId]);

  // Load mastery progress for this test
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sat-mastery-v1");
      const store = raw ? JSON.parse(raw) as Record<string, any> : {};
      const rec = store[testId] || { topics: {}, testMastered: false };
      const topics: Array<{ section: string; topic: string; streak: number; mastered: boolean; lastAccuracy: number }> = Object.values(rec.topics || {}).map((t: any) => ({
        section: t.section,
        topic: t.topic,
        streak: Number(t.streak || 0),
        mastered: !!t.mastered,
        lastAccuracy: Number(t.lastAccuracy || 0),
      }));
      topics.sort((a, b) => (Number(a.mastered) - Number(b.mastered)) || a.streak - b.streak);
      setMastery({ testMastered: !!rec.testMastered, topics });
    } catch {}
  }, [testId, grouped]);

  // Load latest quiz per topic for this test
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_QUIZZES_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        const filtered = arr.filter((q: any) => q && q.testId === testId);
        const map: Record<string, { quizId: string; sessionKey: string; accuracy: number; right: number; total: number; savedAt: number }> = {};
        for (const q of filtered) {
          const key = `${q.section}::${q.topic}`;
          const rec = {
            quizId: String(q.id || q.sessionKey || ""), // Use quiz ID if available
            sessionKey: String(q.sessionKey || ""),
            accuracy: Number(q.accuracy || 0),
            right: Number(q.right || 0),
            total: Number(q.total || 0),
            savedAt: Number(q.savedAt || q.completedAt || 0), // Use completedAt if available
          };
          // Only keep the most recent quiz for each topic (highest savedAt/completedAt)
          if (!map[key] || rec.savedAt > map[key].savedAt) map[key] = rec;
        }
        setLatestQuizzes(map);
      }
    } catch {}
  }, [testId, mastery.topics, topicsSorted]);

  // Mastery helpers
  const masteryMap = useMemo(() => {
    const map: Record<string, { streak: number; mastered: boolean; lastAccuracy: number }> = {};
    mastery.topics.forEach((t) => {
      map[`${t.section}::${t.topic}`] = { streak: t.streak, mastered: t.mastered, lastAccuracy: t.lastAccuracy };
    });
    return map;
  }, [mastery.topics]);

  const nextTarget = useMemo(() => {
    // Next unmastered topic by weakest first (grouped already sorted by count desc earlier)
    for (const g of topicsSorted) {
      const key = `${g.section}::${g.topic}`;
      const rec = masteryMap[key];
      if (!rec || !rec.mastered) return { section: g.section, topic: g.topic };
    }
    return null as null | { section: string; topic: string };
  }, [topicsSorted, masteryMap]);

  const masteredCount = useMemo(() => mastery.topics.filter((t) => t.mastered).length, [mastery.topics]);

  // Mastered topics that were originally struggled (appear in grouped list)
  const struggledTopicsSet = useMemo(() => {
    return new Set(grouped.map((g) => `${g.section}::${g.topic}`));
  }, [grouped]);
  const masteredTopicsFromStruggled = useMemo(() => {
    return mastery.topics.filter((t) => t.mastered && struggledTopicsSet.has(`${t.section}::${t.topic}`));
  }, [mastery.topics, struggledTopicsSet]);

  // Auto-open the group specified by section/topic params once groups are available
  useEffect(() => {
    const key = `${section || ''}::${topic || ''}`;
    if (key !== lastParamKeyRef.current) {
      lastParamKeyRef.current = key;
      setAutoOpenSuppressed(false);
    }
    if (autoOpenSuppressed) return;
    if (!section || !topic) return;
    if (!grouped || grouped.length === 0) return;
    // Already opened
    if (learnModal.group && learnModal.group.section === section && learnModal.group.topic === topic) return;
    const match = grouped.find(g => String(g.section) === section && String(g.topic) === topic);
    if (match) setLearnModal({ group: match as any, idx: 0 });
  }, [section, topic, grouped, learnModal.group, autoOpenSuppressed]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card pop-enter">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {test ? (
              <Link href={`/tests/${test.id}`} className="text-blue-500 hover:text-blue-700 mb-2 inline-block">← Back to {test.name}</Link>
            ) : (
              <span className="text-blue-500 mb-2 inline-block opacity-50 cursor-not-allowed">Loading…</span>
            )}
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Practice missed questions</h1>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">
              {test ? (<>{test.name} {test.testNumber ? `(Test #${test.testNumber})` : ""}</>) : 'Loading practice session...'}
            </p>
          </div>
          <div className="text-sm text-black/60 dark:text-white/60">{queue.length} to review</div>
        </div>
      </div>

      {/* Dashboard body */}
  {/* Topics & Section Split moved below AI Practice Hub per request */}

      {/* AI Practice Bank + Mastered Topics side-by-side */}
      <div className="md:flex md:gap-6">
        {/* AI Practice Bank summary for this test (50% width) */}
        <div className="card pop-enter md:w-1/2 relative overflow-hidden">
          {/* Decorative gradient background */}
          <div className="absolute inset-0 pointer-events-none opacity-25 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.25),transparent_60%),radial-gradient(circle_at_80%_70%,rgba(16,185,129,0.24),transparent_55%)]" />
          <div className="relative flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide font-semibold bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">AI Practice Hub</div>
                <h2 className="mt-1 text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 bg-clip-text text-transparent">Questions & Quizzes</h2>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60 max-w-sm">Your personalized reservoir of missed questions from ai-generated problem sets and adaptive quiz history.</p>
              </div>
              <div className="shrink-0 flex flex-col gap-2 text-xs">
                <Link href={`/tests/${testId}/ai-bank?tab=missed`} className="btn-outline h-8 px-3 text-xs">View questions</Link>
                <Link href={`/tests/${testId}/ai-bank?tab=quizzes`} className="btn-outline h-8 px-3 text-xs">View quizzes</Link>
              </div>
            </div>
            {(() => {
              // Derive quiz count lazily (read once) to avoid extra state clutter
              let quizCount = 0;
              try {
                const raw = localStorage.getItem('sat-ai-quizzes-v1');
                const arr = raw ? JSON.parse(raw) : [];
                if (Array.isArray(arr)) quizCount = arr.filter((q:any) => q && q.testId === testId).length;
              } catch {}
              const total = aiBankCount + quizCount;
              const qPct = total ? Math.round((aiBankCount / total) * 100) : 0;
              const quizPct = total ? 100 - qPct : 0;
              return (
                <div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative rounded-lg p-3 border border-blue-400/30 bg-gradient-to-br from-blue-500/15 via-blue-500/5 to-transparent backdrop-blur-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-medium text-blue-600 dark:text-blue-300">Missed Questions</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-300 border border-blue-500/20">{qPct}%</span>
                      </div>
                      <div className="text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-300">{aiBankCount}</div>
                      <div className="mt-1 h-1.5 rounded-full bg-blue-500/20 overflow-hidden"><div className="h-full bg-blue-500/70" style={{width: `${qPct}%`}} /></div>
                    </div>
                    <div className="relative rounded-lg p-3 border border-emerald-400/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent backdrop-blur-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300">Completed Quizzes</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20">{quizPct}%</span>
                      </div>
                      <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-300">{quizCount}</div>
                      <div className="mt-1 h-1.5 rounded-full bg-emerald-500/20 overflow-hidden"><div className="h-full bg-emerald-500/70" style={{width: `${quizPct}%`}} /></div>
                    </div>
                  </div>
                  {(() => {
                    let avgAccuracy = 0;
                    let last5Avg = 0;
                    try {
                      const raw = localStorage.getItem('sat-ai-quizzes-v1');
                      const arr = raw ? JSON.parse(raw) : [];
                      const list = Array.isArray(arr) ? arr.filter((q:any) => q && q.testId === testId) : [];
                      if (list.length > 0) {
                        avgAccuracy = Math.round(list.reduce((s: number, q: any) => s + (Number(q.accuracy) || 0), 0) / list.length);
                        const last5 = [...list].sort((a,b) => (b.completedAt||b.savedAt||0)-(a.completedAt||a.savedAt||0)).slice(0,5);
                        last5Avg = Math.round(last5.reduce((s: number, q: any) => s + (Number(q.accuracy) || 0), 0) / last5.length);
                      }
                    } catch {}
                    const bar = avgAccuracy;
                    return (
                      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 dark:bg-white/[0.04] p-3 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] uppercase tracking-wide font-semibold text-black/50 dark:text-white/50">Average Accuracy</span>
                          <span className="text-[11px] text-black/50 dark:text-white/50">{quizCount} quiz{quizCount===1?'':'zes'}</span>
                        </div>
                        <div>
                          <div className="flex items-baseline gap-2">
                            <div className="text-3xl font-bold bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">{avgAccuracy}%</div>
                            {quizCount>4 && <div className="text-xs text-black/60 dark:text-white/60">Last 5: {last5Avg}%</div>}
                          </div>
                          <div className="mt-2 h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                            <div className={`h-full ${bar>=80?'bg-emerald-500':bar>=60?'bg-amber-500':'bg-rose-500'}`} style={{width: `${bar}%`}} />
                          </div>
                        </div>
                        {(() => {
                          let ctaLabel = "Start practicing";
                          let ctaHref = `/tests/${testId}/practice`;
                          let helper = "Build accuracy with focused review and adaptive sets.";
                          if (avgAccuracy < 60) {
                            ctaLabel = "Struggling? Go to Learning Hub";
                            ctaHref = `/tests/${testId}/learning-hub`;
                            helper = "Accuracy is low. Visit the Learning Hub for guided explanations before another set.";
                          } else if (avgAccuracy < 80) {
                            ctaLabel = "Keep practicing";
                            if (typeof nextTarget?.section === 'string' && typeof nextTarget?.topic === 'string') {
                              ctaHref = `/tests/${testId}/practice?section=${encodeURIComponent(nextTarget.section)}&topic=${encodeURIComponent(nextTarget.topic)}&regen=1`;
                            }
                            helper = "Solid progress. Push consistency to reach mastery.";
                          } else {
                            ctaLabel = "Challenge yourself";
                            if (typeof nextTarget?.section === 'string' && typeof nextTarget?.topic === 'string') {
                              ctaHref = `/tests/${testId}/practice?section=${encodeURIComponent(nextTarget.section)}&topic=${encodeURIComponent(nextTarget.topic)}&regen=1&tier=up`;
                            }
                            helper = "Great accuracy. Maintain momentum and aim to master remaining topics.";
                          }
                          return (
                            <div className="mt-1 flex flex-col gap-2">
                              <p className="text-[11px] text-black/60 dark:text-white/60 leading-relaxed">{helper}</p>
                              <a href={ctaHref} className="btn-outline h-8 px-3 text-xs w-fit">{ctaLabel}</a>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        </div>
        {/* Mastered Topics Experience Card (50% width) */}
        <div className="card pop-enter mt-6 md:mt-0 md:w-1/2 relative overflow-hidden">
          {/* Background flair (softened) */}
          <div className="absolute inset-0 pointer-events-none opacity-25 bg-[radial-gradient(circle_at_70%_25%,rgba(168,85,247,0.18),transparent_62%),radial-gradient(circle_at_20%_80%,rgba(16,185,129,0.16),transparent_58%),radial-gradient(circle_at_15%_25%,rgba(59,130,246,0.14),transparent_65%)]" />
          {/* Subtle vignette to reduce intensity at edges */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-black/5 via-transparent to-black/10 dark:from-white/5 dark:via-transparent dark:to-white/10" />
          <div className="relative flex flex-col gap-4">
            {(() => {
              const totalTopics = grouped.length;
              const masteredNum = masteredTopicsFromStruggled.length;
              const pct = totalTopics ? Math.round((masteredNum / totalTopics) * 100) : 0;
              const remaining = totalTopics - masteredNum;
              // Build arrays for display (limit counts for scannability)
              const unmasteredTopics = grouped.filter(g => !masteredTopicsFromStruggled.find(m => m.section === g.section && m.topic === g.topic));
              return (
                <>
                  {/* Header + radial progress */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wide font-semibold bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">Mastery Journey</div>
                      <h2 className="mt-1 text-xl sm:text-2xl font-bold bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">Topic Progress</h2>
                      <p className="mt-1 text-xs text-black/60 dark:text-white/60 max-w-sm">Track which previously weak topics you've conquered and what's queued next.</p>
                    </div>
                    <div className="shrink-0 relative w-20 h-20">
                      <svg viewBox="0 0 36 36" className="w-20 h-20 rotate-[-90deg]">
                        <circle cx="18" cy="18" r="16" className="stroke-black/10 dark:stroke-white/10" strokeWidth="3" fill="none" />
                        <circle
                          cx="18" cy="18" r="16" fill="none" strokeWidth="3"
                          className="stroke-gradient-mastered"
                          strokeDasharray={`${(pct/100)*100} 100`}
                          strokeLinecap="round"
                          style={{ stroke: 'url(#gradMastery)' }}
                        />
                        <defs>
                          <linearGradient id="gradMastery" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#34d399" />
                            <stop offset="50%" stopColor="#3b82f6" />
                            <stop offset="100%" stopColor="#a855f7" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-xs font-semibold bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">{pct}%</div>
                      </div>
                    </div>
                  </div>
                  {/* Stats band */}
                  <div className="grid grid-cols-3 gap-3 text-center text-[11px] font-medium">
                    <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-2 backdrop-blur-sm">
                      <div className="text-emerald-600 dark:text-emerald-300 text-lg font-bold leading-none mb-0.5">{masteredNum}</div>
                      <div className="text-emerald-700/80 dark:text-emerald-200/80">Mastered</div>
                    </div>
                    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 backdrop-blur-sm">
                      <div className="text-amber-600 dark:text-amber-300 text-lg font-bold leading-none mb-0.5">{remaining < 0 ? 0 : remaining}</div>
                      <div className="text-amber-700/80 dark:text-amber-200/80">Remaining</div>
                    </div>
                    <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-2 backdrop-blur-sm">
                      <div className="text-blue-600 dark:text-blue-300 text-lg font-bold leading-none mb-0.5">{totalTopics}</div>
                      <div className="text-blue-700/80 dark:text-blue-200/80">Total</div>
                    </div>
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-3 text-[10px] text-black/50 dark:text-white/50 mt-1">
                    <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/80" /> Mastered</div>
                    <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400/80" /> In Progress</div>
                    <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400/80" /> Upcoming</div>
                  </div>
                  {/* Lists */}
                  {totalTopics === 0 ? (
                    <div className="mt-2 text-sm text-black/60 dark:text-white/60 rounded-lg border border-dashed border-white/10 p-4 text-center">
                      No struggled topics yet. Once you add missed questions they'll appear here with progression indicators.
                    </div>
                  ) : mastery.testMastered ? (
                    <div className="mt-2 text-sm text-emerald-600 dark:text-emerald-300 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-center">
                      All topics mastered – great job!
                    </div>
                  ) : (
                    (() => {
                      const current = nextTarget ? grouped.find(g => g.topic === nextTarget.topic && g.section === nextTarget.section) || grouped[0] : grouped[0];
                      if (!current) return null;
                      const key = `${current.section}::${current.topic}`;
                      const streakRec = masteryMap[key];
                      const streak = streakRec?.streak || 0;
                      const isMastered = !!streakRec?.mastered;
                      const badge = isMastered ? 'Mastered' : (streak >= 3 ? 'Hot Streak' : 'Progress');
                      const badgeColor = isMastered ? 'emerald' : streak >= 3 ? 'purple' : 'blue';
                      const pctLocal = isMastered ? 100 : Math.min(100, Math.round((Math.min(streak,5)/5)*100));
                      return (
                        <div className="mt-2 relative rounded-md border border-white/10 bg-white/5 dark:bg-white/[0.04] px-3 py-2 flex items-start gap-3">
                          <div className="mt-0.5 h-8 w-8 shrink-0 relative">
                            <svg viewBox="0 0 36 36" className="w-8 h-8 rotate-[-90deg]">
                              <circle cx="18" cy="18" r="16" className="stroke-black/15 dark:stroke-white/15" strokeWidth="3" fill="none" />
                              <circle cx="18" cy="18" r="16" strokeWidth="3" fill="none" strokeLinecap="round"
                                strokeDasharray={`${(pctLocal/100)*100} 100`}
                                style={{ stroke: isMastered ? '#10b981' : '#f59e0b' }}
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-[10px] font-semibold text-black/70 dark:text-white/70">{isMastered ? '✓' : streak}</span>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium truncate" title={`${current.section} · ${current.topic}`}>{current.section} · {current.topic}</div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border bg-${badgeColor}-500/10 text-${badgeColor}-600 dark:text-${badgeColor}-300 border-${badgeColor}-500/20`}>{badge}</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-black/15 dark:bg-white/10 overflow-hidden">
                              <div className={`h-full ${isMastered ? 'bg-emerald-500/80' : 'bg-amber-400/80'}`} style={{ width: `${pctLocal}%` }} />
                            </div>
                            {!isMastered && (
                              <div className="mt-1 flex items-center justify-between text-[10px] text-black/60 dark:text-white/60">
                                <span>Streak {streak}/5</span>
                                {nextTarget && nextTarget.topic === current.topic && <span className="text-blue-500 dark:text-blue-300">Current</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  )}
                  {/* Empty state encouragement when none mastered */}
                  {masteredNum === 0 && totalTopics > 0 && (
                    <div className="mt-3 relative">
                      <div className="absolute -inset-px rounded-xl bg-gradient-to-r from-blue-500/25 via-purple-500/25 to-emerald-500/25 blur-sm" />
                      <div className="relative rounded-xl border border-white/10 bg-gradient-to-br from-white/60 via-white/30 to-white/10 dark:from-white/10 dark:via-white/5 dark:to-white/0 backdrop-blur-md p-3">
                        <div className="flex items-start gap-3">
                          <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-blue-500/30 via-purple-500/30 to-emerald-500/30 flex items-center justify-center text-[11px] font-bold text-white shadow-inner">i</div>
                          <div className="text-[11px] leading-relaxed text-black/70 dark:text-white/70">
                            Build a <span className="font-semibold text-blue-600 dark:text-blue-300">5-correct streak</span> in adaptive quizzes for any topic to unlock its <span className="font-semibold text-emerald-600 dark:text-emerald-300">Mastered</span> badge.
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-black/50 dark:text-white/50">
                              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Streak in progress</span>
                              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Mastered goal</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Dashboard body (moved) */}
      <div className="card pop-enter">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-black/60 dark:text-white/60">Section split</div>
          {loadingGroups && <div className="text-xs text-black/60 dark:text-white/60">Analyzing…</div>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
            <div className="text-xs text-black/60 dark:text-white/60">Reading</div>
            {loadingGroups && grouped.length === 0 ? (
              <div className="mt-2 h-7 rounded-md bg-black/10 dark:bg-white/10 animate-pulse" />
            ) : (
              <div className="text-2xl font-semibold mt-1">{sectionSplit.reading}</div>
            )}
          </div>
          <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
            <div className="text-xs text-black/60 dark:text-white/60">Math</div>
            {loadingGroups && grouped.length === 0 ? (
              <div className="mt-2 h-7 rounded-md bg-black/10 dark:bg-white/10 animate-pulse" />
            ) : (
              <div className="text-2xl font-semibold mt-1">{sectionSplit.math}</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between" style={{ marginBottom: "18px" }}>
            <div className="text-sm font-medium">Weak topics for this test</div>
            <button
              className="btn-gradient"
              onClick={() => {
                if (!test) return;
                if (topicsSorted.length === 0) return;
                // If an unfinished session exists for this test, resume it
                try {
                  const prefix = `sat-practice-session-${testId}-`;
                  let latestKey: string | null = null;
                  let latestMeta: { section?: string; topic?: string } = {};
                  let newest = 0;
                  for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i) || '';
                    if (!k.startsWith(prefix)) continue;
                    const raw = localStorage.getItem(k);
                    if (!raw) continue;
                    try {
                      const parsed = JSON.parse(raw);
                      const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
                      const ans = parsed?.answers || {};
                      const updatedAt = Number(parsed?.updatedAt || 0);
                      if (qs.length > 0 && Object.keys(ans).length < qs.length && updatedAt > newest) {
                        newest = updatedAt;
                        latestKey = k;
                        latestMeta = { section: parsed?.section, topic: parsed?.topic };
                      }
                    } catch {}
                  }
                  if (latestKey) {
                    router.push(`/tests/${testId}/practice?key=${encodeURIComponent(latestKey)}`);
                    return;
                  }
                } catch {}

                // Otherwise start a new set from the top weak topic
                const target = topicsSorted[0];
                const sec = encodeURIComponent(String(target.section || ''));
                const top = encodeURIComponent(String(target.topic || ''));
                router.push(`/tests/${testId}/practice?section=${sec}&topic=${top}&regen=1`);
              }}
              disabled={(grouped.length === 0 || !test)}
            >
              Start Practicing
            </button>
          </div>
          {groupError && (
            <div className="text-sm text-rose-600 dark:text-rose-400 mb-2">{groupError}</div>
          )}
          {loadingGroups && grouped.length === 0 ? (
            <div className="grid gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-md border border-black/10 dark:border-white/10 p-3">
                  <div className="h-4 w-1/2 rounded bg-black/10 dark:bg-white/10 animate-pulse" />
                  <div className="mt-2 h-3 w-24 rounded bg-black/10 dark:bg-white/10 animate-pulse" />
                </div>
              ))}
            </div>
          ) : topicsSorted.length > 0 ? (
            <div className="grid gap-2">
              {topicsSorted.map((g, idx) => (
                <div key={idx} className="rounded-md border border-black/10 dark:border-white/10 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-semibold">{g.section}</span> · {g.topic}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                        {g.question?.length ?? 0} question{(g.question?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                      <button
                        className="btn-outline h-7 px-2 text-xs leading-none rounded-full"
                        onClick={() => setViewGroup(g as any)}
                      >
                        View questions
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-black/60 dark:text-white/60">No topics yet.</div>
          )}
      </div>


      {/* Learn-specific topic modal (auto-opened via query params) */}
      {learnModal.group && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setAutoOpenSuppressed(true); setLearnModal({ group: null, idx: 0 }); }} />
          <div className="relative w-full sm:max-w-2xl mx-auto m-0 sm:m-6 card pop-enter rounded-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Learning Focus</h2>
                <div className="text-sm text-black/60 dark:text-white/60 mt-0.5">{learnModal.group.section} · {learnModal.group.topic}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-outline h-8 px-3 text-xs" onClick={() => { setAutoOpenSuppressed(true); setLearnModal({ group: null, idx: 0 }); }}>Close</button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {(() => {
                const group = learnModal.group!;
                const total = group.question?.length || 0;
                const currentIdx = Math.min(learnModal.idx, Math.max(0,total-1));
                const currentRaw = group.question[currentIdx];
                const parsed = parseQuestionText(currentRaw || '');
                return (
                  <>
                    <div className="flex items-center justify-between text-xs text-black/60 dark:text-white/60">
                      <div>{currentIdx+1} / {total} question{total===1?'':'s'}</div>
                      <div className="flex gap-2">
                        <button
                          className="btn-outline h-7 px-2 text-[11px]"
                          disabled={currentIdx===0}
                          onClick={() => setLearnModal(s => ({ ...s, idx: Math.max(0, s.idx-1) }))}
                        >Prev</button>
                        <button
                          className="btn-outline h-7 px-2 text-[11px]"
                          disabled={currentIdx>=total-1}
                          onClick={() => setLearnModal(s => ({ ...s, idx: Math.min(total-1, s.idx+1) }))}
                        >Next</button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 bg-black/5 dark:bg-white/5">
                      {parsed.stem && <div className="font-medium mb-3 whitespace-pre-wrap break-words">{parsed.stem}</div>}
                      {parsed.choices.length >= 2 && (
                        <ol className="list-none space-y-2 text-sm">
                          {parsed.choices.map(c => (
                            <li key={c.label} className="flex gap-2">
                              <span className="font-semibold w-6 shrink-0">{c.label}</span>
                              <span className="break-words whitespace-pre-wrap flex-1">{c.text}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {!parsed.stem && !parsed.choices.length && (
                        <div className="font-medium break-words whitespace-pre-wrap">{currentRaw}</div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          className="btn-outline h-8 px-3 text-xs"
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/learn/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: currentRaw, section: learnModal.group!.section, topic: learnModal.group!.topic }) });
                              if (!res.ok) return;
                              const data = await res.json().catch(()=>({}));
                              alert(data?.explanation || 'Explanation generated (placeholder).');
                            } catch {}
                          }}
                        >Generate Explanation</button>
                        <button
                          className="btn-outline h-8 px-3 text-xs"
                          onClick={() => setLearnModal(s => ({ ...s, idx: (s.idx+1) % total }))}
                          disabled={total<=1}
                        >Quick Next ↵</button>
                      </div>
                    </div>
                    {total>1 && (
                      <div className="grid gap-2 max-h-40 overflow-auto pr-1">
                        {group.question.map((q,i) => (
                          <button
                            key={i}
                            onClick={() => setLearnModal(s => ({ ...s, idx: i }))}
                            className={`text-left rounded-md border px-2 py-1 text-[11px] truncate ${i===currentIdx? 'bg-blue-500/10 border-blue-400/40 text-blue-600 dark:text-blue-300':'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'}`}
                            title={q}
                          >Q{i+1}: {q.slice(0,80)}{q.length>80?'…':''}</button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* View grouped questions modal (practice-style) */}
      {viewGroup && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setAutoOpenSuppressed(true); setViewGroup(null); }} />
          <div className="relative w-full sm:max-w-3xl mx-auto m-0 sm:m-6 card pop-enter rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{viewGroup.section} · {viewGroup.topic} ({viewGroup.question?.length ?? 0})</h2>
              <button className="btn-outline" onClick={() => { setAutoOpenSuppressed(true); setViewGroup(null); }}>Close</button>
            </div>
            <div className="mt-4 entry-group pop-enter max-h-[70vh] overflow-auto">
              {viewGroup.question && viewGroup.question.length > 0 ? (
                viewGroup.question.map((q, i) => (
                  <div key={i} className="entry-row">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {(() => {
                          const parsed = parseQuestionText(q);
                          if (parsed.choices.length >= 2) {
                            return (
                              <div className="space-y-2">
                                <div className="font-medium break-words whitespace-normal">{parsed.stem}</div>
                                <ol className="list-none space-y-1 text-sm">
                                  {parsed.choices.map((c) => (
                                    <li key={c.label} className="flex gap-2">
                                      <span className="font-semibold w-6 shrink-0">{c.label}</span>
                                      <span className="break-words whitespace-normal">{c.text}</span>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            );
                          }
                          return <div className="font-medium break-words whitespace-normal">{q}</div>;
                        })()}
                        <div className="mt-1 text-sm text-black/70 dark:text-white/70 break-words whitespace-normal">
                          {viewGroup.section} · Grouped topic: {viewGroup.topic}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-black/60 dark:text-white/60">No questions in this group.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive popup removed; replaced with dedicated practice page navigation */}
    </div>
  );
}


