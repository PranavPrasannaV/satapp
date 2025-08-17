"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type AIItem = {
  id: string;
  section: string;
  topic: string;
  source: string;
  questionNumber?: number;
  tags: string[];
  status: string;
  testId?: string;
  // Added optional linkage so we can remove missed questions created by a specific quiz
  originSessionKey?: string;
};

const AI_STORAGE_KEY = "sat-ai-practice-bank-v1";
const AI_QUIZZES_KEY = "sat-ai-quizzes-v1";

export default function TestAIBankPage() {
  const params = useParams();
  const testId = params.testId as string;
  const sp = useSearchParams();
  const router = useRouter();
  const initialTab = (sp.get('tab') === 'quizzes') ? 'quizzes' : 'missed';
  const [tab, setTab] = useState<"missed" | "quizzes">(initialTab);
  const [items, setItems] = useState<AIItem[]>([]);
  const [quizzes, setQuizzes] = useState<any[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const list: AIItem[] = Array.isArray(arr) ? arr : [];
      // Keep only items explicitly tied to this testId
      const scoped = list.filter(i => i.testId === testId);
      setItems(scoped);
    } catch {}
  }, [testId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_QUIZZES_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const list: any[] = Array.isArray(arr) ? arr.filter((q) => q.testId === testId) : [];
      setQuizzes(list);
    } catch {}
  }, [testId]);

  function onDelete(id: string) {
    setItems((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      try { localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function onDeleteQuiz(id: string) {
    if (!window.confirm('Delete this quiz and its missed questions? This cannot be undone.')) return;
    setQuizzes((prev) => {
      const quiz = prev.find(q => q.id === id);
      const updated = prev.filter(q => q.id !== id);
      try { localStorage.setItem(AI_QUIZZES_KEY, JSON.stringify(updated)); } catch {}
      if (quiz) {
        try {
          const raw = localStorage.getItem(AI_STORAGE_KEY);
          const arr = raw ? JSON.parse(raw) : [];
          // Build a set of question texts from the quiz (for legacy cleanup where originSessionKey missing)
          const quizQuestionTexts: Set<string> = new Set(
            Array.isArray(quiz.questions)
              ? quiz.questions.map((q: any) => (typeof q?.question === 'string' ? q.question : '')).filter(Boolean)
              : []
          );
          const filtered = Array.isArray(arr) ? arr.filter((item: any) => {
            // If item tied directly to this quiz via originSessionKey, remove it
            if (quiz.sessionKey && item.originSessionKey && item.originSessionKey === quiz.sessionKey) return false;
            // Legacy heuristic: remove if testId matches AND topic matches one of quiz question texts
            if (!item.originSessionKey && quizQuestionTexts.size > 0) {
              if (item.testId === quiz.testId && quizQuestionTexts.has(item.topic)) return false;
            }
            return true;
          }) : [];
          localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(filtered));
          // Reflect in local state now (remove both linked & legacy matched)
          setItems(prevItems => prevItems.filter(it => {
            if (quiz.sessionKey && it.originSessionKey === quiz.sessionKey) return false;
            if (!it.originSessionKey && quizQuestionTexts.size > 0 && it.testId === quiz.testId && quizQuestionTexts.has(it.topic)) return false;
            return true;
          }));
        } catch {}
      }
      return updated;
    });
  }

  return (
    <div className="space-y-6">
      <div className="card pop-enter">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/tests/${testId}/learn`} className="text-blue-500 hover:text-blue-700 mb-2 inline-block">← Back to Practice</Link>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">AI Practice Bank</h1>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">Review and manage AI-generated questions you missed and view your quiz history.</p>
          </div>
          <div className="text-sm text-black/60 dark:text-white/60">
            {tab === "missed" ? `${items.length} saved` : `${quizzes.length} completed`}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="inline-flex rounded-lg bg-white/15 p-1">
          {["missed", "quizzes"].map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t as any);
                try {
                  const url = new URL(window.location.href);
                  url.searchParams.set('tab', t);
                  router.replace(url.pathname + '?' + url.searchParams.toString());
                } catch {}
              }}
              className={`px-3 h-9 rounded-md text-sm font-medium transition ${tab === t ? "bg-white/90 text-black" : "text-white/90 hover:bg-white/10"}`}
            >
              {t === "missed" ? "Missed questions" : "Quiz history"}
            </button>
          ))}
        </div>

        {tab === "missed" ? (
          items.length === 0 ? (
            <div className="text-sm text-black/60 dark:text-white/60">No AI questions saved yet.</div>
          ) : (
            <div className="entry-group pop-enter">
              {items.map((i) => (
                <div key={i.id} className="entry-row">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium break-words whitespace-normal">{i.topic}</div>
                      <div className="mt-1 text-sm text-black/70 dark:text-white/70 break-words whitespace-normal">
                        {i.section} · {i.source}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => onDelete(i.id)} className="btn-outline text-rose-600 dark:text-rose-300 border-rose-300/50">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          quizzes.length === 0 ? (
            <div className="text-sm text-black/60 dark:text-white/60">No quiz history yet.</div>
          ) : (
            <div className="grid gap-3">
              {quizzes
                .sort((a, b) => (b.completedAt || b.savedAt || 0) - (a.completedAt || a.savedAt || 0)) // Sort by completion time, newest first
                .map((q) => (
                <div key={q.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="text-sm font-medium">{q.section} · {q.topic}</div>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          q.accuracy >= 80 
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                            : q.accuracy >= 60
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20'
                            : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20'
                        }`}>
                          {q.accuracy}%
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4 text-xs text-black/60 dark:text-white/60 mb-2">
                        <div>
                          <div className="font-medium text-emerald-600 dark:text-emerald-400">{q.right}</div>
                          <div>Correct</div>
                        </div>
                        <div>
                          <div className="font-medium text-rose-600 dark:text-rose-400">{q.wrong}</div>
                          <div>Wrong</div>
                        </div>
                        <div>
                          <div className="font-medium text-amber-600 dark:text-amber-400">{q.skipped || 0}</div>
                          <div>Skipped</div>
                        </div>
                      </div>
                      
                      <div className="text-xs text-black/60 dark:text-white/60">
                        Completed: {new Date(q.completedAt || q.savedAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-2 shrink-0">
                      <Link 
                        href={`/tests/${testId}/practice?quizId=${encodeURIComponent(q.id)}&section=${encodeURIComponent(q.section || '')}&topic=${encodeURIComponent(q.topic || '')}`} 
                        className="btn-outline text-xs"
                      >
                        Open
                      </Link>
                      <button
                        onClick={() => onDeleteQuiz(q.id)}
                        className="btn-outline text-xs text-rose-600 dark:text-rose-300 border-rose-300/50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}


