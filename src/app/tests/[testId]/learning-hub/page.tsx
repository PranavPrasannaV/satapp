"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
/** This page intentionally slim: header card + Mastery Status card */

type Section = "Reading" | "Math-Calculator" | "Math-No-Calculator" | string;
interface MissedQuestion { id: string; section: Section; topic: string; testId?: string; userAnswer?: string; }

const MISSED_KEY = "sat-missed-questions-v1"; // for deriving struggled topics ordering
const MASTERy_KEY = "sat-mastery-v1";
const AI_QUIZZES_KEY = "sat-ai-quizzes-v1";
const ANALYSIS_STORAGE_KEY = "sat-analysis-v1"; // reuse grouping cache from practice/learn page
const WEAK_TOPICS_CACHE_KEY = "sat-weak-topics-cache-v1"; // dedicated weak topics cache

interface MasteryStoreTopic { section: string; topic: string; streak: number; mastered: boolean; lastAccuracy: number; }

export default function LearningHubPage() {
  const { testId } = useParams<{ testId: string }>();

  // Missed questions (for ordering of weak topics)
  const [missed, setMissed] = useState<MissedQuestion[]>([]);
  const [classifiedGroups, setClassifiedGroups] = useState<Array<{ section: string; topic: string; question: string[] }>>([]);
  const [classifying, setClassifying] = useState(false);
  const [classifyError, setClassifyError] = useState<string | null>(null);

  // Question preview modal
  const [questionModal, setQuestionModal] = useState<{ open: boolean; question?: MissedQuestion; parsed?: { stem: string; choices: { label: string; text: string }[] }; pendingAnswer?: string }>(() => ({ open: false }));

  // Load classified groups from the cache populated by the main practice page
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
      if (raw) {
        const map = JSON.parse(raw) as Record<string, { signature: string; groups: any; savedAt: number }>;
        const rec = map?.[testId];
        if (rec && Array.isArray(rec.groups)) {
          setClassifiedGroups(rec.groups);
        }
      }
    } catch {}
  }, [testId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MISSED_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setMissed(arr.filter((q: any) => q && q.testId === testId));
      }
    } catch {}
  }, [testId]);

  // Derive topic order similar to practice page (grouped list ordered by frequency)
  const topicsSorted = useMemo(() => {
    const map = new Map<string, { section: string; topic: string; count: number }>();
    missed.forEach(q => {
      const key = `${q.section}::${q.topic}`;
      if (!map.has(key)) map.set(key, { section: q.section, topic: q.topic, count: 0 });
      map.get(key)!.count += 1;
    });
    return Array.from(map.values()).sort((a,b) => b.count - a.count).map(m => ({ section: m.section, topic: m.topic, question: Array.from({ length: m.count }) }));
  }, [missed]);

  // Helpers reused for mastery normalization + display
  const looksLikeQuestion = (s: string) => /\b(A\.|B\.|C\.|D\.|\(A\)|\(B\)|\(C\)|\(D\))/.test(s) || (s?.length || 0) > 140;
  const normLower = (s: string) => (s || '').replace(/\s+/g,' ').trim().toLowerCase();
  const displayTopic = (raw: string) => {
    if (!raw) return raw;
    if (!looksLikeQuestion(raw)) return raw;
    const norm = normLower(raw);
    const grp = classifiedGroups.find(g => g.question.some(q => normLower(q) === norm));
    return grp ? grp.topic : raw;
  };

  // Mastery store (with normalization & persistence of corrected topic labels)
  const [mastery, setMastery] = useState<{ testMastered: boolean; topics: MasteryStoreTopic[] }>({ testMastered: false, topics: [] });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MASTERy_KEY);
      const store = raw ? JSON.parse(raw) as Record<string, any> : {};
      const rec = store[testId] || { topics: {}, testMastered: false };
      const entries: Array<[string, any]> = Object.entries(rec.topics || {});
      let changed = false;
      const normalizedEntries = entries.map(([key, t]) => {
        let topicVal = String(t.topic || '');
        let sectionVal = String(t.section || '');
        if (looksLikeQuestion(topicVal)) {
          const grp = classifiedGroups.find(g => Array.isArray(g.question) && g.question.some(q => normLower(q) === normLower(topicVal)));
            if (grp) {
              if (grp.topic !== topicVal) changed = true;
              topicVal = grp.topic;
              if (grp.section && grp.section !== sectionVal) sectionVal = grp.section;
            }
        }
        return [key, { ...t, topic: topicVal, section: sectionVal }];
      });
      // Persist normalization if any changes
      if (changed) {
        const newTopicsObj: Record<string, any> = {};
        normalizedEntries.forEach(([k, v]) => { newTopicsObj[k] = v; });
        store[testId] = { ...rec, topics: newTopicsObj };
        try { localStorage.setItem(MASTERy_KEY, JSON.stringify(store)); } catch {}
      }
      let topics: MasteryStoreTopic[] = normalizedEntries.map(([, t]) => ({
        section: String(t.section || ''),
        topic: String(t.topic || ''),
        streak: Number(t.streak || 0),
        mastered: !!t.mastered,
        lastAccuracy: Number(t.lastAccuracy || 0)
      }));
      topics.sort((a,b) => (Number(a.mastered) - Number(b.mastered)) || a.streak - b.streak);
      setMastery({ testMastered: !!rec.testMastered, topics });
    } catch {}
  }, [testId, topicsSorted, classifiedGroups]);

  // Latest quiz per topic
  const [latestQuizzes, setLatestQuizzes] = useState<Record<string, { quizId: string; sessionKey: string; accuracy: number; right: number; total: number; savedAt: number }>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_QUIZZES_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        const filtered = arr.filter((q: any) => q && q.testId === testId);
        const map: Record<string, any> = {};
        for (const q of filtered) {
          const key = `${q.section}::${q.topic}`;
            const rec = { quizId: String(q.id || q.sessionKey || ''), sessionKey: String(q.sessionKey || ''), accuracy: Number(q.accuracy || 0), right: Number(q.right || 0), total: Number(q.total || 0), savedAt: Number(q.savedAt || q.completedAt || 0) };
            if (!map[key] || rec.savedAt > map[key].savedAt) map[key] = rec;
        }
        setLatestQuizzes(map);
      }
    } catch {}
  }, [testId, mastery.topics, topicsSorted]);

  // Derived helpers
  const masteryMap = useMemo(() => {
    const map: Record<string, { streak: number; mastered: boolean; lastAccuracy: number }> = {};
    mastery.topics.forEach(t => { map[`${t.section}::${t.topic}`] = { streak: t.streak, mastered: t.mastered, lastAccuracy: t.lastAccuracy }; });
    return map;
  }, [mastery.topics]);

  // Next target: prefer explicit mastery store ordering (sorted earlier by mastered + streak), fallback to frequency list
  const nextTarget = useMemo(() => {
    for (const t of mastery.topics) {
      if (!t.mastered) return { section: t.section, topic: t.topic };
    }
    if (mastery.topics.length === 0) {
      const first = topicsSorted[0];
      if (first) return { section: first.section, topic: first.topic };
    }
    return null as null | { section: string; topic: string };
  }, [mastery.topics, topicsSorted]);

  const masteredCount = useMemo(() => mastery.topics.filter(t => t.mastered).length, [mastery.topics]);

  // Accurate missed count per topic
  const missedCounts = useMemo(() => {
    const map: Record<string, number> = {};
    missed.filter(m => m.testId === testId).forEach(m => {
      const group = classifiedGroups.find(g => g.question.includes(m.topic));
      const topic = group ? group.topic : m.topic;
      const key = `${m.section}::${topic}`;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [missed, testId, classifiedGroups]);

  // Explanation modal state
  const [explainState, setExplainState] = useState<{ open: boolean; loading: boolean; error?: string | null; content?: string | null; contentHtml?: string | null; topic?: { section: string; topic: string }; }>(() => ({ open: false, loading: false }));

  function markdownToHtml(md: string): string {
    // ultra-light markdown transform (headings, lists, bold, italics, code)
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Lists
    html = html.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    // Numbered
    html = html.replace(/^(\d+)\. (.*)$/gm, '<li>$2</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, m => m.startsWith('<ul>') ? m : `<ol>${m}</ol>`);
    html = html.replace(/\n{2,}/g, '<br/><br/>');
    return html;
  }

  async function openExplain(opts: { section: string; topic: string; examples?: string | string[] }) {
    const examples = Array.isArray(opts.examples) ? opts.examples.join('\n---\n') : (opts.examples || '');
    setExplainState({ open: true, loading: true, error: null, content: null, contentHtml: null, topic: { section: opts.section, topic: opts.topic } });
    try {
      const res = await fetch('/api/learn/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section: opts.section, topic: opts.topic, examples })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const explanation = String(data.explanation || '');
      setExplainState(s => ({ ...s, loading: false, content: explanation, contentHtml: markdownToHtml(explanation) }));
    } catch (e: any) {
      setExplainState(s => ({ ...s, loading: false, error: e?.message || 'Failed to generate explanation' }));
    }
  }

  // Fallback groups: classified if available else frequency-derived
  const fallbackGroups = useMemo(() => (classifiedGroups.length > 0 ? classifiedGroups : topicsSorted), [classifiedGroups, topicsSorted]);
  const firstWeakTopic = useMemo(() => {
    for (const g of fallbackGroups) {
      const key = `${g.section}::${g.topic}`; const rec = masteryMap[key];
      if (!rec || !rec.mastered) return { section: g.section, topic: g.topic };
    }
    return null as null | { section: string; topic: string };
  }, [fallbackGroups, masteryMap]);

  // Chosen target for BOTH gradient header & sub card (ensures identical display)
  const chosenTarget = useMemo(() => {
    if (mastery.testMastered) return null;
    return firstWeakTopic || nextTarget || null;
  }, [mastery.testMastered, firstWeakTopic, nextTarget]);

  const masteryHeaderLabel = useMemo(() => {
    if (mastery.testMastered) return 'All topics mastered';
    if (chosenTarget) return displayTopic(chosenTarget.topic);
    return 'In progress';
  }, [mastery.testMastered, chosenTarget, classifiedGroups]);

  // Add userAnswer to MissedQuestion and add question modal logic
  function parseQuestionText(raw: string): { stem: string; choices: { label: string; text: string }[] } {
    if (!raw) return { stem: '', choices: [] };
    let text = raw.replace(/\u2022/g, '•').replace(/\s+/g, ' ').trim();
    text = text
      .replace(/\bquestion\s*\d+\b/gi, '')
      .replace(/\b(prompt|answers?)\b/gi, '')
  // Remove standalone placeholder word 'blank' (and bracketed/parenthesized forms) from UI display only
  .replace(/\[(?:blank)\]/gi, ' ')
  .replace(/\((?:blank)\)/gi, ' ')
  .replace(/\bblank\b/gi, ' ')
  // Remove 'blank' when immediately following one or more underscores (e.g., ______blank)
  .replace(/(_+)\s*blank/gi, '$1')
      .replace(/\s+/g, ' ') // collapse again
      .trim();
    const labels = ['A','B','C','D'] as const;
    const indices: { label: string; idx: number }[] = [];
    labels.forEach(l => {
      const r = new RegExp(`(?:\\b|\\n|\\r|\\s)(?:\\(${l}\\)|${l}\\)|${l}\\.|${l}: )`, 'i');
      const m = r.exec(text);
      if (m && m.index >= 0) indices.push({ label: `${l}.`, idx: m.index });
    });
    if (indices.length < 2) return { stem: text, choices: [] };
    indices.sort((a,b) => a.idx - b.idx);
    const firstIdx = indices[0].idx;
    const stem = text.slice(0, firstIdx).replace(/\s*•+\s*$/g, '').trim();
    const segments: { label: string; text: string }[] = [];
    for (let i=0;i<indices.length;i++) {
      const start = indices[i].idx;
      const end = i+1 < indices.length ? indices[i+1].idx : text.length;
      let seg = text.slice(start, end).trim();
      const labLetter = indices[i].label[0];
      const pattern = `^(?:\\(${labLetter}\\)|${labLetter}\\)|${labLetter}\\.|${labLetter}:)` + '\\s*';
      seg = seg.replace(new RegExp(pattern, 'i'), '').trim();
      seg = seg.replace(/^•\s*/g, '').trim();
      segments.push({ label: indices[i].label, text: seg });
    }
    return { stem: stem || raw.trim(), choices: segments };
  }

  function normalizeQuestionText(s: string) {
    return (s || '').replace(/\s+/g,' ').trim();
  }

  function hashString(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
  }

  function resolveGroupQuestions(section: string, topicLabel: string): MissedQuestion[] {
    // Prefer classified groups (they contain actual question text list)
    const grp = classifiedGroups.find(g => g.section === section && g.topic === topicLabel);
    if (grp && Array.isArray(grp.question)) {
      const set = new Set(grp.question.map(q => normalizeQuestionText(q)));
      // Match missed questions for test whose normalized text is in the group
      const matches = missed.filter(m => m.section === section && set.has(normalizeQuestionText(m.topic)));
      // Order them as they appear in grp.question
      const orderMap = new Map<string, number>();
      grp.question.forEach((q, i) => orderMap.set(normalizeQuestionText(q), i));
      matches.sort((a,b) => (orderMap.get(normalizeQuestionText(a.topic)) || 0) - (orderMap.get(normalizeQuestionText(b.topic)) || 0));
      return matches;
    }
    // Fallback: frequency derived (topicsSorted) does not store individual question texts, so group by same section then arbitrary
    return missed.filter(m => m.section === section).sort((a,b) => a.id.localeCompare(b.id));
  }

  function openTopicQuestion(section: string, topicLabel: string) {
    const list = resolveGroupQuestions(section, topicLabel);
    if (list.length === 0) {
      setQuestionModal({ open: true });
      return;
    }
    const first = list[0];
    const parsed = parseQuestionText(first.topic);
    setQuestionModal({ open: true, question: first, parsed, pendingAnswer: first.userAnswer });
  }

  function saveUserAnswer(answer: string) {
    const q = questionModal.question;
    if (!q) return;
    try {
      const raw = localStorage.getItem(MISSED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        const updated = arr.map((rec: any) => rec && rec.id === q.id ? { ...rec, userAnswer: answer } : rec);
        localStorage.setItem(MISSED_KEY, JSON.stringify(updated));
        setMissed(updated.filter((m: any) => m && m.testId === testId));
        setQuestionModal(s => ({ ...s, pendingAnswer: answer, question: { ...q, userAnswer: answer } }));
      }
    } catch (e) { /* noop */ }
  }

  // Local learn modal state for in-hub quick view
  const [learnModal, setLearnModal] = useState<{ open: boolean; section?: string; topic?: string; questions?: MissedQuestion[]; index?: number; coachLoading?: boolean; coachError?: string | null; coachAnalysis?: string | null; coachCache?: Record<string, string>; }>(() => ({ open: false }));

  function openLearnModal(section: string, topic: string) {
    let questions: MissedQuestion[] = [];
    // Try to find classified group first (has canonical question text list)
    const classified = classifiedGroups.find(g => g.section === section && g.topic === topic);
    if (classified && Array.isArray(classified.question) && classified.question.length > 0) {
      questions = classified.question.map((qTxt, i) => {
        // Try to locate matching missed question to inherit stored userAnswer
        const norm = normalizeQuestionText(qTxt);
        const mq = missed.find(m => m.section === section && normalizeQuestionText(m.topic) === norm);
        return {
          id: mq?.id || `grp-${section}-${topic}-${i}`,
          section,
          topic: qTxt,
          testId: testId as string,
          userAnswer: mq?.userAnswer
        };
      });
    } else {
      // Fallback: approximate by picking missed whose section matches and (if we have any classified groups) belongs to same topic label via inclusion test
      const normTopic = topic.toLowerCase();
      const inSameGroup = (m: MissedQuestion) => {
        // If we had no classified group, just keep same section
        if (!classifiedGroups.length) return true;
        // Otherwise include if this question text appears in any group with same topic label
        const holder = classifiedGroups.find(cg => cg.section === section && cg.topic === topic && cg.question.some(txt => normalizeQuestionText(txt) === normalizeQuestionText(m.topic)));
        return !!holder;
      };
      questions = missed.filter(m => m.section === section && inSameGroup(m)).map((m, i) => ({ ...m, id: m.id || `missed-${i}` }));
    }
  setLearnModal({ open: true, section, topic, questions, index: 0, coachLoading: false, coachError: null, coachAnalysis: null, coachCache: {} });
  }

  async function runCoach(idx?: number) {
    setLearnModal(s => ({ ...s, coachLoading: true, coachError: null }));
    try {
      const s = learnModal;
      const qs = s.questions || [];
      const current = qs[Math.min(idx ?? (s.index||0), qs.length-1)];
      if (!current) throw new Error('No question');
      // If cached already, just surface it
      if (s.coachCache && s.coachCache[current.id || current.topic]) {
        setLearnModal(s2 => ({ ...s2, coachLoading: false, coachAnalysis: s.coachCache![current.id || current.topic] }));
        return;
      }
  const res = await fetch('/api/learn/coach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section: current.section, topic: s.topic, question: current.topic, studentAnswer: current.userAnswer || '' })
      });
      if (!res.ok) {
        const e = await res.json().catch(()=>({}));
        throw new Error(e.error || 'Request failed');
      }
      const data = await res.json();
      // Support new structured JSON format
      if (data.structured) {
        const serialized = JSON.stringify(data.structured);
        setLearnModal(s2 => ({ ...s2, coachLoading: false, coachAnalysis: serialized, coachCache: { ...(s2.coachCache||{}), [current.id || current.topic]: serialized } }));
      } else {
        const md = String(data.analysis || data.raw || '');
        setLearnModal(s2 => ({ ...s2, coachLoading: false, coachAnalysis: md, coachCache: { ...(s2.coachCache||{}), [current.id || current.topic]: md } }));
      }
    } catch (e:any) {
      setLearnModal(s => ({ ...s, coachLoading: false, coachError: e.message || 'Failed to analyze' }));
    }
  }

  // Auto-run coach when question changes (if not cached)
  useEffect(() => {
    if (!learnModal.open) return;
    const qs = learnModal.questions || [];
    const current = qs[Math.min(learnModal.index||0, qs.length-1)];
    if (!current) return;
    const cached = learnModal.coachCache?.[current.id || current.topic];
    if (cached && !learnModal.coachAnalysis) {
      setLearnModal(s => ({ ...s, coachAnalysis: cached }));
      return;
    }
    if (!cached && !learnModal.coachLoading && !learnModal.coachError) {
      runCoach();
    }
  }, [learnModal.open, learnModal.index, learnModal.questions]);

  // UI
  return (
    <>
    <div className="space-y-6">
      <div className="card pop-enter">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href={`/tests/${testId}/learn`} className="text-blue-500 hover:text-blue-700 mb-2 inline-block">← Back to Practice Hub</Link>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Learning Hub</h1>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">Targeted concept refreshers based on your current weaknesses. Review fundamentals before jumping back into practice sets.</p>
          </div>
        </div>
      </div>
      {/* Weak topics quick-learn cards */}
      {((classifiedGroups.length > 0 || topicsSorted.length > 0) && missed.length > 0) && (
        <div className="card pop-enter">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-black/70 dark:text-white/70">Your weak topics</div>
            <div className="text-xs text-black/50 dark:text-white/50">Click Learn for on-demand explanation</div>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 snap-x no-scrollbar">
            {classifying && classifiedGroups.length === 0 && (
              <div className="text-xs text-black/60 dark:text-white/60 flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2" className="opacity-25"/><path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2" className="opacity-75"/></svg>
                Loading topics…
              </div>
            )}
            {(classifiedGroups.length > 0 ? classifiedGroups : topicsSorted).filter(g => {
              const key = `${g.section}::${g.topic}`;
              const rec = masteryMap[key];
              return !rec || !rec.mastered;
            }).map(g => {
              const key = `${g.section}::${g.topic}`;
              const rec = masteryMap[key] || { lastAccuracy: 0 };
              const count = missedCounts[key] || g.question?.length || 0;
              const isPrimary = firstWeakTopic && g.section === firstWeakTopic.section && g.topic === firstWeakTopic.topic;
              return (
                <div key={key} className={`relative rounded-xl border border-black/10 dark:border-white/10 p-3 w-56 shrink-0 snap-start flex flex-col ${!isPrimary ? 'opacity-60' : ''}`}>
                  <div className="text-xs text-black/50 dark:text-white/50 mb-1 truncate" title={g.section}>{g.section}</div>
                  <div className="font-medium text-sm truncate mb-1 flex items-center gap-1" title={g.topic}>
                    {!isPrimary && (
                      <svg className="w-3.5 h-3.5 text-black/50 dark:text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="11" width="18" height="10" rx="2" ry="2" strokeWidth="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                    {g.topic}
                  </div>
                  <div className="text-[11px] text-black/50 dark:text-white/50 mb-2">Missed: {count}{rec.lastAccuracy ? ` • Last Acc: ${rec.lastAccuracy}%` : ''}</div>
                  {isPrimary ? (
                    <button onClick={() => openLearnModal(g.section, g.topic)} className="mt-auto btn-outline h-8 text-xs px-2">Learn</button>
                  ) : (
                    <div className="mt-auto h-8 flex items-center text-[11px] gap-1 text-black/50 dark:text-white/40 select-none">Locked</div>
                  )}
                  {!isPrimary && <div className="absolute inset-0 rounded-xl pointer-events-none" />}
                </div>
              );
            })}
            {!classifying && (classifiedGroups.length > 0 ? classifiedGroups : topicsSorted).filter(g => {
              const key = `${g.section}::${g.topic}`; const rec = masteryMap[key]; return !rec || !rec.mastered;
            }).length === 0 && (
              <div className="text-xs text-black/60 dark:text-white/60">All struggled topics mastered 🎉</div>
            )}
            {classifyError && (
              <div className="text-[11px] text-red-500">{classifyError}</div>
            )}
          </div>
        </div>
      )}
      {/* Mastery status card copied from practice page */}
      <div className="card pop-enter">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-xl p-2 bg-gradient-to-tr from-blue-500/20 via-purple-500/20 to-emerald-500/20 border border-white/10">
              {mastery.testMastered ? (
                <svg className="w-6 h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 19l7-7-7-7M5 5v14" />
                </svg>
              )}
            </div>
            <div>
              <div className="text-sm text-black/60 dark:text-white/60">Mastery status</div>
              <div className="mt-1 text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">
                <span className="truncate max-w-[60vw] sm:max-w-[40vw]" title={masteryHeaderLabel}>{masteryHeaderLabel}</span>
              </div>
              <div className="text-xs text-black/60 dark:text-white/60 mt-1">{masteredCount} mastered topic{masteredCount === 1 ? '' : 's'}</div>
            </div>
          </div>
          {mastery.testMastered ? (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 self-start">Mastered</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 self-start">In progress</span>
          )}
        </div>
        <div className="mb-4">
          <div className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            {(() => {
              const total = Math.max(1, mastery.topics.length || topicsSorted.length || 1);
              const pct = Math.min(100, Math.round((masteredCount / total) * 100));
              return <div className="h-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
            })()}
          </div>
        </div>
        <div className="grid gap-3">
          {(!nextTarget && mastery.topics.length === 0) ? (
            <div className="text-sm text-black/60 dark:text-white/60">No mastery data yet. Start practicing to build streaks.</div>
          ) : (
            (() => {
              const current = chosenTarget; // unified with header
              if (mastery.testMastered || !current) {
                return <div className="text-sm text-black/60 dark:text-white/60">All topics mastered.</div>;
              }
              const key = `${current.section}::${current.topic}`;
              const rec = masteryMap[key] || { streak: 0, mastered: false, lastAccuracy: 0 };
              const pct = Math.min(100, Math.round((Math.min(rec.streak, 5) / 5) * 100));
              const quiz = latestQuizzes[key];
              const display = displayTopic(current.topic);
              return (
                <div className="md:flex md:items-stretch md:gap-3">
                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-3 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-medium truncate" title={`${display}`}>{display}</div>
                      {rec.mastered ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">Mastered</span>
                      ) : (
                        <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full border border-blue-500/20 bg-blue-500/10">
                          <span className="text-[11px] text-blue-700 dark:text-blue-300">Streak</span>
                          <div className="flex items-center gap-1" aria-label={`Streak ${rec.streak} of 5`}>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <span key={i} className={`h-2 w-2 rounded-full ${i < rec.streak ? 'bg-blue-500' : 'bg-blue-300/30 dark:bg-blue-200/20'}`} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
          <div className="text-[11px] mb-2 text-black/50 dark:text-white/50">{current.section}</div>
                    <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div className="h-full bg-blue-500/70" style={{ width: `${pct}%` }} />
                    </div>
                    {!rec.mastered && (
                      <div className="text-xs text-black/60 dark:text-white/60 mt-2">Last accuracy: {rec.lastAccuracy}%</div>
                    )}
                  </div>
                  <div className="mt-3 md:mt-0 md:w-56 shrink-0 rounded-xl border border-black/10 dark:border-white/10 p-3 flex flex-col">
                    <div className="text-xs text-black/60 dark:text-white/60 mb-1">Need help?</div>
                    <div className="text-sm font-medium mb-1">Explain Mistakes</div>
                    <div className="text-[11px] text-black/50 dark:text-white/50 mb-2">Get a concise lesson + mini drill for this topic.</div>
                    <button
                      onClick={() => {
            openExplain({ section: current.section, topic: display, examples: (quiz ? [`${quiz.right}/${quiz.total} recent performance`] : []) });
                      }}
                      className="btn-outline mt-auto h-8 text-xs px-2">
                      Explain My Mistakes
                    </button>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>
      {/* Explanation Modal */}
      {explainState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExplainState(s => ({ ...s, open: false }))} />
          <div className="relative z-10 w-full max-w-xl max-h-[85vh] overflow-hidden rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl flex flex-col">
            <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50 mb-0.5">Topic</div>
                <div className="font-semibold text-sm truncate max-w-[55vw]">{explainState.topic?.topic}</div>
              </div>
              <button onClick={() => setExplainState(s => ({ ...s, open: false }))} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10">
                <span className="sr-only">Close</span>
                <svg className="w-4 h-4" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6"/></svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto text-sm whitespace-pre-wrap">
              {explainState.loading && (
                <div className="flex items-center gap-2 text-black/60 dark:text-white/60">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2" className="opacity-25"/><path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2" className="opacity-75"/></svg>
                  Generating explanation...
                </div>
              )}
              {!explainState.loading && explainState.error && (
                <div className="text-red-500 text-xs">{explainState.error}</div>
              )}
              {!explainState.loading && !explainState.error && explainState.content && (
                <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: explainState.contentHtml || explainState.content }} />
              )}
            </div>
            <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex items-center justify-end gap-2">
              <button onClick={() => setExplainState(s => ({ ...s, open: false }))} className="btn-outline h-8 text-xs px-3">Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Question Preview Modal */}
      {questionModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setQuestionModal({ open: false })} />
          <div className="relative w-full sm:max-w-2xl mx-auto card pop-enter rounded-2xl max-h-[85vh] overflow-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Missed Question Preview</h2>
              <button className="btn-outline" onClick={() => setQuestionModal({ open: false })}>Close</button>
            </div>
            <div className="mt-4 space-y-4">
              {!questionModal.question && (
                <div className="text-sm text-black/60 dark:text-white/60">No saved question text found for this topic yet.</div>
              )}
              {questionModal.question && (
                <div className="space-y-3">
                  {(() => {
                    const parsed = questionModal.parsed;
                    if (parsed && parsed.choices.length >= 2) {
                      return (
                        <div className="space-y-3">
                          <div className="font-medium break-words whitespace-normal">{parsed.stem}</div>
                          <ol className="list-none space-y-1 text-sm">
                            {parsed.choices.map(c => (
                              <li key={c.label} className="flex gap-2">
                                <span className="font-semibold w-6 shrink-0">{c.label}</span>
                                <span className="break-words whitespace-normal">{c.text}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      );
                    }
                    return <div className="font-medium break-words whitespace-normal">{questionModal.question.topic}</div>;
                  })()}
                  <div className="text-xs text-black/60 dark:text-white/60">
                    {questionModal.question.section} · {questionModal.question.topic.slice(0, 60)}{questionModal.question.topic.length>60?'…':''}
                  </div>
                  {!questionModal.question.userAnswer && (
                    <div className="pt-2 border-t border-black/10 dark:border-white/10">
                      <div className="text-xs mb-1 text-black/60 dark:text-white/60">What answer did you select?</div>
                      <div className="flex items-center gap-2">
                        {['A','B','C','D'].map(a => (
                          <button
                            key={a}
                            onClick={() => saveUserAnswer(a)}
                            className={`h-8 w-8 rounded-md border text-sm font-medium ${questionModal.pendingAnswer===a ? 'bg-blue-500 text-white border-blue-500' : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10'}`}
                          >{a}</button>
                        ))}
                      </div>
                      <div className="mt-2 text-[11px] text-black/50 dark:text-white/50">This is stored locally and lets future analytics know your misconception.</div>
                    </div>
                  )}
                  {questionModal.question.userAnswer && (
                    <div className="pt-2 border-t border-black/10 dark:border-white/10 text-sm">
                      Your recorded answer: <span className="font-semibold">{questionModal.question.userAnswer}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {questionModal.question && (
              <div className="flex items-center gap-2 pt-2 border-t border-black/10 dark:border-white/10">
                <button
                  className="btn-outline h-8 text-xs px-2"
                  onClick={() => {
                    if (!questionModal.question) return;
                    // Recompute ordered list for the current classification topic
                    const section = questionModal.question.section;
                    // Need to find which classification topic label we navigated from: derive by locating group containing this question text
                    const normCurrent = normalizeQuestionText(questionModal.question.topic);
                    let topicLabel: string | undefined;
                    for (const g of classifiedGroups) {
                      if (g.section === section && Array.isArray(g.question) && g.question.some(q => normalizeQuestionText(q) === normCurrent)) {
                        topicLabel = g.topic;
                        break;
                      }
                    }
                    if (!topicLabel) {
                      // Fallback: cannot resolve group, keep same question
                      return;
                    }
                    const list = resolveGroupQuestions(section, topicLabel);
                    if (list.length === 0) return;
                    const idx = list.findIndex(q => q.id === questionModal.question!.id);
                    const next = list[(idx + 1) % list.length];
                    const parsed = parseQuestionText(next.topic);
                    setQuestionModal(s => ({ ...s, question: next, parsed, pendingAnswer: next.userAnswer }));
                  }}
                >Next</button>
                <div className="text-[11px] text-black/50 dark:text-white/50 ml-auto">
                  {(() => {
                    if (!questionModal.question) return null;
                    const normCurrent = normalizeQuestionText(questionModal.question.topic);
                    const section = questionModal.question.section;
                    let topicLabel: string | undefined;
                    for (const g of classifiedGroups) {
                      if (g.section === section && g.question.some(q => normalizeQuestionText(q) === normCurrent)) { topicLabel = g.topic; break; }
                    }
                    if (!topicLabel) return null;
                    const list = resolveGroupQuestions(section, topicLabel);
                    const idx = list.findIndex(q => q.id === questionModal.question!.id);
                    return list.length ? `Question ${idx+1} of ${list.length}` : null;
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
  </div>
    {learnModal.open && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLearnModal({ open: false })} />
        <div className="relative w-full sm:max-w-2xl mx-auto m-0 sm:m-6 card pop-enter rounded-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{learnModal.topic}</h2>
                <div className="text-xs text-black/60 dark:text-white/60 mt-0.5">{learnModal.section}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-outline h-8 px-3 text-xs"
                  disabled={!learnModal.questions || (learnModal.index||0) <= 0}
                    onClick={() => setLearnModal(s => (!s.questions ? s : { ...s, index: Math.max(0, (s.index||0) - 1), coachAnalysis: null }))}
                >Prev</button>
                <button
                  className="btn-outline h-8 px-3 text-xs"
                  disabled={!learnModal.questions || (learnModal.index||0) >= (learnModal.questions.length - 1)}
                    onClick={() => setLearnModal(s => (!s.questions ? s : { ...s, index: Math.min(s.questions.length - 1, (s.index||0) + 1), coachAnalysis: null }))}
                >Next</button>
                <button className="btn-outline h-8 px-3 text-xs" onClick={() => setLearnModal({ open: false })}>Close</button>
              </div>
            </div>
            {/* Top question tabs */}
            {learnModal.questions && learnModal.questions.length > 1 && (
              <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 border-b border-black/10 dark:border-white/10">
                {learnModal.questions.map((q,i) => (
                  <button
                    key={q.id || i}
                    onClick={() => setLearnModal(s => ({ ...s, index: i, coachAnalysis: null }))}
                    className={`px-3 py-1 rounded-md text-xs font-medium border shrink-0 transition ${i===(learnModal.index||0)
                      ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                      : 'border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black/70 dark:text-white/70'}`}
                  >Q{i+1}</button>
                ))}
                <div className="ml-auto text-[11px] px-1 py-1 text-black/50 dark:text-white/50 whitespace-nowrap">Question {(learnModal.index||0)+1} of {learnModal.questions.length}</div>
              </div>
            )}
          <div className="mt-4 grid gap-4 max-h-[70vh] overflow-auto pr-1 sm:grid-cols-2">
            {(() => {
              const qs = learnModal.questions || [];
              if (qs.length === 0) {
                return <div className="text-sm text-black/60 dark:text-white/60">(Loading grouped questions… Try again in a moment.)</div>;
              }
              const current = qs[Math.min(learnModal.index||0, qs.length-1)];
              if (!current) return null;
              const parsed = parseQuestionText(current.topic);
              return (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 bg-gradient-to-br from-black/5 via-blue-500/5 to-emerald-500/5 dark:from-white/5 dark:via-blue-400/5 dark:to-emerald-400/5 backdrop-blur-sm text-left">
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
                    {!parsed.choices.length && !parsed.stem && (
                      <div className="font-medium break-words whitespace-pre-wrap">{current.topic}</div>
                    )}
                    {current.userAnswer && (
                      <div className="mt-4 text-[11px] text-black/60 dark:text-white/60">Your answer: <span className="font-semibold">{current.userAnswer}</span></div>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* AI Coach Panel */}
      <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm relative overflow-auto no-scrollbar max-h-[70vh]">
              <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50 mb-2">AI Coach Analysis</div>
              {learnModal.coachError && <div className="text-xs text-red-500 mb-2">{learnModal.coachError}</div>}
              {!learnModal.coachAnalysis && !learnModal.coachLoading && !learnModal.coachError && (
        <div className="text-[11px] text-black/60 dark:text-white/60">Preparing analysis…</div>
              )}
              {learnModal.coachLoading && (
                <div className="flex items-center gap-2 text-black/60 dark:text-white/60 text-xs">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2" className="opacity-25"/><path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2" className="opacity-75"/></svg>
                  Analyzing your mistake…
                </div>
              )}
              {learnModal.coachAnalysis && (
        <CoachStructured raw={learnModal.coachAnalysis} />
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </>
  );
}

// Structured renderer for AI coach output with section cards & hidden scrollbar
function CoachStructured({ raw }: { raw: string }) {
  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let structured: any = null;
  if (raw.startsWith('{')) {
    try { structured = JSON.parse(raw); } catch {}
  }
  const text = raw.replace(/\r/g,'');
  if (structured && structured.correctAnswer) {
    // Render structured JSON version deterministically
    return (
      <div className="space-y-4 text-[11px]">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="font-medium">Correct Answer:</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-300">{structured.correctAnswer}</span>
          {structured.correctAnswerText && <span className="ml-1 text-black/70 dark:text-white/70">{structured.correctAnswerText}</span>}
        </div>
        <div className="grid gap-3">
          <SectionCard title="What the Question Tested" tone="blue">
            <p><strong>{esc(structured.whatTested?.concept || '')}</strong> · {esc(structured.whatTested?.difficulty || '')}</p>
            <p className="mt-1 leading-relaxed">{esc(structured.whatTested?.summary || '')}</p>
          </SectionCard>
          <SectionCard title="Why Your Answer Is Wrong" tone="rose">
            <p className="leading-relaxed"><strong>Missed:</strong> {esc(structured.whyWrong?.missedIdea || '')}</p>
            {structured.whyWrong?.trapType && <p className="mt-1"><strong>Trap:</strong> {esc(structured.whyWrong.trapType)}</p>}
            {structured.studentAnswer && <p className="mt-1"><strong>Why {esc(structured.studentAnswer)} looked attractive:</strong> {esc(structured.whyWrong?.whyStudentAnswerAttractive || '')}</p>}
            {Array.isArray(structured.whyWrong?.otherOptions) && structured.whyWrong.otherOptions.length > 0 && (
              <ul className="mt-2 list-disc ml-4 space-y-1">
                {structured.whyWrong.otherOptions.map((o:any,i:number)=>(
                  <li key={i}><span className="font-semibold">{esc(o.option)}:</span> {esc(o.issue)}</li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Why the Correct Answer Works" tone="emerald">
            <p className="leading-relaxed">{esc(structured.whyCorrect?.reasoning || '')}</p>
          </SectionCard>
          <SectionCard title="Gameplan to Fix This Mistake Type" tone="purple">
            <ul className="list-disc ml-4 space-y-1">{(structured.gameplan||[]).map((b:string,i:number)=>(<li key={i}>{esc(b)}</li>))}</ul>
          </SectionCard>
        </div>
      </div>
    );
  }
  // Identify correct answer mention (heuristic)
  // Support both "Correct Answer is B" and "**Correct Answer**: B. innocuous" forms.
  const correctMatch = /\*\*Correct Answer\*\*:?\s*([A-D])\b|correct answer (?:is|:)?\s*([A-D])/i.exec(text);
  const correct = correctMatch ? (correctMatch[1] || correctMatch[2]) : undefined;
  const sectionOrder = [
    'What the Question Tested',
    'Why Your Answer Is Wrong',
    'Why the Correct Answer Works',
    'Gameplan to Fix This Mistake Type'
  ];
  const regex = /\n?(\d+)\.\s+(What the Question Tested|Why Your Answer Is Wrong|Why the Correct Answer Works|Gameplan to Fix This Mistake Type)\s*/g;
  const pieces: Array<{ title: string; body: string }> = [];
  let lastTitle: string | null = null; let lastPos = 0; let m: RegExpExecArray | null; let startBody = 0;
  while ((m = regex.exec(text))) {
    if (lastTitle) {
      pieces.push({ title: lastTitle, body: text.slice(startBody, m.index).trim() });
    }
    lastTitle = m[2];
    startBody = regex.lastIndex;
  }
  if (lastTitle) pieces.push({ title: lastTitle, body: text.slice(startBody).trim() });
  if (pieces.length === 0) pieces.push({ title: 'Analysis', body: text });

  function bodyBlocks(body: string) {
    const segs = body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    // Inline formatter: converts **bold** to <strong> while escaping other content.
    function fmtInline(src: string) {
      const parts: string[] = [];
      let last = 0; let m: RegExpExecArray | null;
      const rx = /\*\*(.+?)\*\*/g;
      while ((m = rx.exec(src))) {
        // Preceding text
        if (m.index > last) parts.push(esc(src.slice(last, m.index)));
        const inner = esc(m[1]);
        parts.push(`<strong>${inner}</strong>`);
        last = m.index + m[0].length;
      }
      if (last < src.length) parts.push(esc(src.slice(last)));
      return parts.join('');
    }
    return segs.map((seg, i) => {
      const lines = seg.split(/\n/).filter(l => l.trim());
      const bullet = lines.every(l => /^(- |\* |\d+\. )/.test(l));
      if (bullet) {
        return (
          <ul key={i} className="list-disc ml-4 space-y-1 text-[11px] marker:text-black/50 dark:marker:text-white/40">
            {lines.map((l,j) => {
              const rawLine = l.replace(/^(- |\* |\d+\. )/,'').trim();
              return <li key={j} dangerouslySetInnerHTML={{ __html: fmtInline(rawLine) }} />;
            })}
          </ul>
        );
      }
      return <p key={i} className="text-[11px] leading-relaxed" dangerouslySetInnerHTML={{ __html: fmtInline(seg) }} />;
    });
  }
  const icon = (title: string) => {
    switch (title) {
      case 'What the Question Tested': return <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path d="M12 8v5" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>;
      case 'Why Your Answer Is Wrong': return <svg className="w-4 h-4 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2l9 21H3L12 2z" strokeWidth="2" strokeLinejoin="round"/><path d="M12 10v5" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>;
      case 'Why the Correct Answer Works': return <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
      case 'Gameplan to Fix This Mistake Type': return <svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16v4H4zM4 12h16v8H4z" strokeWidth="2" strokeLinejoin="round"/><path d="M9 16h6" strokeWidth="2" strokeLinecap="round"/></svg>;
      default: return <svg className="w-4 h-4 text-black/40 dark:text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2"/></svg>;
    }
  };
  return (
    <div className="space-y-4">
      {correct && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 flex items-center gap-2 text-[11px]">
          <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="font-medium">Correct Answer:</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-300">{correct}</span>
        </div>
      )}
      {pieces.map(p => (
        <div key={p.title} className="rounded-xl border border-black/10 dark:border-white/10 bg-gradient-to-br from-white/60 via-white/40 to-white/20 dark:from-neutral-800/70 dark:via-neutral-800/50 dark:to-neutral-800/30 p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            {icon(p.title)}
            <h3 className="text-[11px] font-semibold tracking-wide uppercase text-black/70 dark:text-white/70">{p.title}</h3>
          </div>
          <div className="space-y-2">
            {bodyBlocks(p.body)}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionCard({ title, tone, children }: { title: string; tone: 'blue'|'rose'|'emerald'|'purple'; children: any }) {
  const toneMap: Record<string,string> = {
    blue: 'border-blue-300/30 bg-blue-500/5',
    rose: 'border-rose-300/30 bg-rose-500/5',
    emerald: 'border-emerald-300/30 bg-emerald-500/5',
    purple: 'border-purple-300/30 bg-purple-500/5'
  };
  const icon = {
    blue: <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path d="M12 8v5" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>,
    rose: <svg className="w-4 h-4 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2l9 21H3L12 2z" strokeWidth="2" strokeLinejoin="round"/><path d="M12 10v5" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>,
    emerald: <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 13l4 4L19 7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    purple: <svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16v4H4zM4 12h16v8H4z" strokeWidth="2" strokeLinejoin="round"/><path d="M9 16h6" strokeWidth="2" strokeLinecap="round"/></svg>
  } as const;
  return (
    <div className={`rounded-xl border p-3 backdrop-blur-sm ${toneMap[tone]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon[tone]}
        <h3 className="text-[11px] font-semibold tracking-wide uppercase text-black/70 dark:text-white/70">{title}</h3>
      </div>
      <div className="space-y-2 text-[11px] leading-relaxed">{children}</div>
    </div>
  );
}
