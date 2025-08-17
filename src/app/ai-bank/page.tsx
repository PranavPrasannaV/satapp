"use client";

import { useEffect, useMemo, useState } from "react";
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
};

const AI_STORAGE_KEY = "sat-ai-practice-bank-v1";

export default function AIBankPage() {
  const [items, setItems] = useState<AIItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AI_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      setItems(Array.isArray(arr) ? arr : []);
    } catch {}
  }, []);

  function onDelete(id: string) {
    setItems((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      try { localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  return (
    <div className="space-y-6">
      <div className="card pop-enter">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/" className="text-blue-500 hover:text-blue-700 mb-2 inline-block">← Back to dashboard</Link>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">AI Practice Bank</h1>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">Review and manage AI-generated questions you missed.</p>
          </div>
          <div className="text-sm text-black/60 dark:text-white/60">{items.length} saved</div>
        </div>
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
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
        )}
      </div>
    </div>
  );
}


