"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Section = "Reading" | "Math-Calculator" | "Math-No-Calculator";
type Status = "New" | "Reviewing" | "Mastered";

type MissedQuestion = {
  id: string;
  section: Section;
  topic: string;
  source: string; // e.g., CB Practice Test 8
  questionNumber?: number;
  tags: string[];
  status: Status;
  testId?: string; // Add testId to link questions to specific tests
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

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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
    const r = new RegExp(`(?:\\b|\n|\r|\s)(?:\\(${lab}\\)|${lab}\\)|${lab}\\.|${lab}:)`, "i");
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

type FancySelectProps<T extends string> = {
  value: T | "All";
  options: readonly T[] | readonly (T | "All")[];
  onChange: (v: T | "All") => void;
  className?: string;
  placeholder?: string;
};

function FancySelect<T extends string>({ value, options, onChange, className = "", placeholder }: FancySelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const label = String(value ?? placeholder ?? "Select");
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" className="field select w-full text-left" onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur shadow-lg overflow-hidden">
          <ul role="listbox" className="max-h-56 overflow-auto py-1">
            {options.map((opt) => (
              <li key={String(opt)}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 ${opt === value ? "bg-black/5 dark:bg-white/10" : ""}`}
                  onClick={() => {
                    onChange(opt as T | "All");
                    setOpen(false);
                  }}
                >
                  {String(opt)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type BadgeTone = "default" | "green" | "amber" | "blue" | "red";
type BadgeProps = { children: React.ReactNode; tone?: BadgeTone };

function Badge({ children, tone = "default" }: BadgeProps) {
  const tones: Record<BadgeTone, string> = {
    default:
      "bg-black/5 dark:bg-white/10 text-foreground border border-black/10 dark:border-white/10",
    green:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20",
    amber:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20",
    blue:
      "bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20",
    red:
      "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function Home() {
  const [items, setItems] = useState<MissedQuestion[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [tests, setTests] = useState<PracticeTest[]>([]);
  const [testsLoaded, setTestsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<Section | "All">("All");
  const [status, setStatus] = useState<Status | "All">("All");
  const [questionFilter, setQuestionFilter] = useState("");
  const [editing, setEditing] = useState<MissedQuestion | null>(null);
  const [activeTab, setActiveTab] = useState<"Overview" | "List">("Overview");
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'practiceTest' | 'question'>('question');
  const [showFilters, setShowFilters] = useState(false);
  // Modal select state
  const [formSection, setFormSection] = useState<Section>("Reading");
  const [formStatus, setFormStatus] = useState<Status>("New");
  // Practice test form state
  const [formData, setFormData] = useState({
    source: '',
    testNumber: ''
  });

  // Load from localStorage with lightweight migration
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
    } catch {}
    finally {
      setItemsLoaded(true);
    }
  }, []);

  // Load practice tests
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PRACTICE_TESTS_STORAGE_KEY);
      console.log('Loading practice tests from localStorage:', stored);
      if (stored) {
        const loadedTests = JSON.parse(stored);
        console.log('Parsed practice tests:', loadedTests);
        setTests(loadedTests);
      }
      setTestsLoaded(true);
    } catch (error) {
      console.error('Error loading practice tests:', error);
      setTestsLoaded(true);
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (!itemsLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items, itemsLoaded]);

  // Save practice tests to localStorage
  useEffect(() => {
    if (!testsLoaded) return; // Don't save until we've loaded from localStorage
    
    try {
      console.log('Saving practice tests to localStorage:', tests);
      localStorage.setItem(PRACTICE_TESTS_STORAGE_KEY, JSON.stringify(tests));
    } catch (error) {
      console.error('Error saving practice tests:', error);
    }
  }, [tests, testsLoaded]);

  // Debug: Log when tests state changes
  useEffect(() => {
    console.log('Tests state changed:', tests);
  }, [tests]);

  const stats = useMemo(() => {
    const total = items.length;
    const mastered = items.filter((i) => i.status === "Mastered").length;
    const reviewing = items.filter((i) => i.status === "Reviewing").length;
    const bySection = items.reduce<Record<string, number>>((acc, i) => {
      acc[i.section] = (acc[i.section] ?? 0) + 1;
      return acc;
    }, {});
    return { total, mastered, reviewing, bySection, masteryRate: total ? Math.round((mastered / total) * 100) : 0 };
  }, [items]);

  const practiceTestStats = useMemo(() => {
    const total = tests.length;
    const totalQuestions = items.filter(item => item.testId).length;
    const testsWithQuestions = tests.filter(test => 
      items.some(item => item.testId === test.id)
    ).length;
    return { 
      total, 
      totalQuestions, 
      testsWithQuestions,
      averageQuestionsPerTest: total > 0 ? Math.round(totalQuestions / total) : 0
    };
  }, [tests, items]);


  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const qQuestion = questionFilter.toLowerCase().trim();
    return items.filter((i) => {
      if (section !== "All" && i.section !== section) return false;
      if (status !== "All" && i.status !== status) return false;
      if (q) {
        const hay = `${i.topic} ${i.source}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (qQuestion) {
        const parsed = parseQuestionText(i.topic);
        const hayQ = `${parsed.stem} ${parsed.choices.map((c) => `${c.label} ${c.text}`).join(" ")}`.toLowerCase();
        if (!hayQ.includes(qQuestion)) return false;
      }
      return true;
    });
  }, [items, section, status, search, questionFilter]);

  function resetForm() {
    setEditing(null);
    setFormSection("Reading");
    setFormStatus("New");
    setFormData({ source: '', testNumber: '' });
    const form = document.getElementById("entry-form") as HTMLFormElement | null;
    if (form) form.reset();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    
    if (modalMode === 'practiceTest') {
      // Adding a practice test
      if (!formData.source.trim()) {
        alert('Please fill in the source');
        return;
      }

      const newTest: PracticeTest = {
        id: uid(),
        name: formData.source.trim(),
        source: formData.source.trim(),
        testNumber: formData.testNumber ? parseInt(formData.testNumber) : undefined,
        createdAt: new Date().toISOString()
      };

      console.log('Adding new practice test:', newTest);
      setTests(prev => {
        const updated = [newTest, ...prev];
        console.log('Updated tests array:', updated);
        return updated;
      });
      setFormData({ source: '', testNumber: '' });
      setShowModal(false);
      return;
    }

    // Adding a question (Overview tab)
    const obj: MissedQuestion = {
      id: editing?.id ?? uid(),
      section: formSection,
      topic: (fd.get("topic") as string).trim(),
      source: (fd.get("source") as string).trim(),
      questionNumber: Number(fd.get("qnum")) || undefined,
      tags: [],
      status: formStatus,
      testId: undefined, // Questions added from main page don't belong to a specific test
    };
    if (!obj.topic || !obj.source) return;

    setItems((prev) => {
      if (editing) {
        return prev.map((p) => (p.id === editing.id ? obj : p));
      }
      return [obj, ...prev];
    });
    e.currentTarget.reset();
    setEditing(null);
    setShowModal(false);
  }

  function onEdit(item: MissedQuestion) {
    setEditing(item);
    // Populate form fields via DOM since we keep it simple
    const form = document.getElementById("entry-form") as HTMLFormElement | null;
    if (!form) return;
    (form.elements.namedItem("section") as HTMLSelectElement).value = item.section;
    (form.elements.namedItem("topic") as HTMLInputElement).value = item.topic;
    (form.elements.namedItem("source") as HTMLInputElement).value = item.source;
    (form.elements.namedItem("qnum") as HTMLInputElement).value = String(item.questionNumber ?? "");
    // no tags field
    setFormSection(item.section);
    setFormStatus(item.status);
    setShowModal(true);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  }

  function onDelete(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    if (editing?.id === id) setEditing(null);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sat-missed-questions.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data)) {
          // Basic shape check
          const cleaned = data
            .filter((d) => d && d.id && d.section && d.topic && d.source)
            .map((d) => ({
              id: String(d.id),
              section: d.section,
              topic: d.topic,
              source: d.source,
              questionNumber: d.questionNumber,
              tags: Array.isArray(d.tags) ? d.tags : [],
              status: d.status ?? "New",
              testId: d.testId || undefined,
            }));
          setItems(cleaned);
        }
      } catch {}
    };
    reader.readAsText(file);
    // reset input
    e.target.value = "";
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card pop-enter">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">SAT Missed Questions Tracker</h1>
            <p className="text-sm text-black/60 dark:text-white/60 mt-1">Track mistakes, tag causes, and review smarter.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setModalMode('practiceTest'); setShowModal(true); }} className="btn-gradient">+ Add Practice Test</button>
            {activeTab !== "List" && (
              <button onClick={() => setActiveTab("List")} className="btn-outline">View All Tests</button>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="mt-4 inline-flex rounded-lg bg-white/15 p-1">
          {(["Overview", "List"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 h-9 rounded-md text-sm font-medium transition ${activeTab === t ? "bg-white/90 text-black" : "text-white/90 hover:bg-white/10"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "Overview" && (
        <div className="space-y-6">
          {/* Stats */}
          <section className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="card pop-enter">
              <div className="text-xs text-black/60 dark:text-white/60">Practice Tests</div>
              <div className="text-2xl font-semibold mt-1">{practiceTestStats.total}</div>
            </div>
            <div className="card pop-enter">
              <div className="text-xs text-black/60 dark:text-white/60">Total Questions</div>
              <div className="text-2xl font-semibold mt-1">{practiceTestStats.totalQuestions}</div>
            </div>
            <div className="card pop-enter">
              <div className="text-xs text-black/60 dark:text-white/60">Tests with Questions</div>
              <div className="text-2xl font-semibold mt-1">{practiceTestStats.testsWithQuestions}</div>
            </div>
            <div className="card pop-enter">
              <div className="text-xs text-black/60 dark:text-white/60">Avg Questions/Test</div>
              <div className="text-2xl font-semibold mt-1">{practiceTestStats.averageQuestionsPerTest}</div>
            </div>
          </section>

          {/* Recent Practice Tests */}
          {tests.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold mb-3">Recent Practice Tests</h3>
              <div className="grid gap-3">
                {tests.slice(0, 5).map((test) => {
                  const testQuestions = items.filter(item => item.testId === test.id);
                  const masteredQuestions = testQuestions.filter(item => item.status === "Mastered").length;
                  const masteryRate = testQuestions.length > 0 ? Math.round((masteredQuestions / testQuestions.length) * 100) : 0;
                  
                  return (
                    <div key={test.id} className="card pop-enter">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <Link href={`/tests/${test.id}`} className="inline-block">
                            <h4 className="font-medium hover:text-blue-400 transition-colors truncate">
                              {test.name}
                            </h4>
                          </Link>
                          <div className="flex items-center gap-4 text-sm text-black/60 dark:text-white/60 mt-1">
                            {test.testNumber && (
                              <span>Test #{test.testNumber}</span>
                            )}
                            <span>{testQuestions.length} questions</span>
                            {testQuestions.length > 0 && (
                              <span>{masteryRate}% mastered</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Link href={`/tests/${test.id}`} className="btn-outline">View</Link>
                          <Link
                            href={`/tests/${test.id}/learn`}
                            className="btn-gradient"
                            onClick={(e) => {
                              if (testQuestions.length === 0) {
                                e.preventDefault();
                                alert("You must add at least 1 question to this test before you can practice missed.");
                              }
                            }}
                          >
                            Practice missed
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* AI Question Bank moved to per-test page */}
        </div>
      )}

      {activeTab === "List" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-black/60 dark:text-white/60">{tests.length} practice test{tests.length !== 1 ? 's' : ''} logged</div>
          </div>

          {tests.length === 0 ? (
            <div className="text-center text-black/60 dark:text-white/60 py-12">
              <div className="max-w-md mx-auto">
                <div className="mb-6">
                  <svg className="mx-auto h-12 w-12 text-black/40 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-black/80 dark:text-white/80 mb-2">No practice tests logged yet</h3>
                <p className="text-black/60 dark:text-white/60 mb-6">Start tracking your SAT practice by adding your first practice test.</p>
                <button 
                  onClick={() => { resetForm(); setModalMode('practiceTest'); setShowModal(true); }}
                  className="btn-gradient inline-flex items-center"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Your First Practice Test
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {tests.map((test) => (
                <div key={test.id} className="card pop-enter">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <Link href={`/tests/${test.id}`} className="inline-block">
                        <h3 className="text-lg font-semibold mb-1 hover:text-blue-400 transition-colors truncate">
                          {test.name}
                        </h3>
                      </Link>
                      <div className="flex items-center gap-4 text-sm text-black/60 dark:text-white/60">
                        {test.testNumber && (
                          <span className="flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                            </svg>
                            Test #{test.testNumber}
                          </span>
                        )}
                        {(() => {
                          const testQuestions = items.filter(item => item.testId === test.id);
                          return (
                            <span className="flex items-center">
                              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18" />
                              </svg>
                              {testQuestions.length} questions
                            </span>
                          );
                        })()}
                        <span className="flex items-center">
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {new Date(test.createdAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link href={`/tests/${test.id}`} className="btn-outline">View</Link>
                      <Link
                        href={`/tests/${test.id}/learn`}
                        className="btn-gradient"
                        onClick={(e) => {
                          const testQuestions = items.filter(item => item.testId === test.id);
                          if (testQuestions.length === 0) {
                            e.preventDefault();
                            alert("You must add at least 1 question to this test before you can practice missed.");
                          }
                        }}
                      >
                        Practice missed
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowModal(false); resetForm(); }} />
          <div className="relative w-full sm:max-w-2xl mx-auto m-0 sm:m-6 card pop-enter">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {modalMode === 'practiceTest' ? "Add Practice Test" : (editing ? "Edit Entry" : "Add New Entry")}
              </h2>
              <button className="btn-outline" onClick={() => { setShowModal(false); resetForm(); }}>Close</button>
            </div>
            
            {modalMode === 'practiceTest' ? (
              // Practice Test Form
              <form id="entry-form" onSubmit={onSubmit} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="source" className="block text-sm font-medium text-black/80 dark:text-white/80 mb-1">
                    Source *
                  </label>
                  <input
                    type="text"
                    id="source"
                    name="source"
                    value={formData.source}
                    onChange={handleInputChange}
                    placeholder="e.g., Bluebook, Khan Academy, Princeton Review"
                    className="field w-full"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="testNumber" className="block text-sm font-medium text-black/80 dark:text-white/80 mb-1">
                    Test Number (Optional)
                  </label>
                  <input
                    type="number"
                    id="testNumber"
                    name="testNumber"
                    value={formData.testNumber}
                    onChange={handleInputChange}
                    placeholder="e.g., 1, 2, 3"
                    min="1"
                    className="field w-full"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); resetForm(); }}
                    className="btn-outline flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-gradient flex-1"
                  >
                    Add Practice Test
                  </button>
                </div>
              </form>
            ) : (
              // Question Form
              <form id="entry-form" onSubmit={onSubmit} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                {/* Custom select with hidden input for form submit */}
                <input type="hidden" name="section" value={formSection} />
                <FancySelect<Section>
                  value={formSection}
                  onChange={(v) => setFormSection(v as Section)}
                  options={["Reading", "Math-Calculator", "Math-No-Calculator"] as const}
                />
                <input type="hidden" name="status" value={formStatus} />
                <FancySelect<Status>
                  value={formStatus}
                  onChange={(v) => setFormStatus(v as Status)}
                  options={["New", "Reviewing", "Mastered"] as const}
                />
                <input name="source" placeholder="Source (e.g., Bluebook PT3)" required className="field" />
                <input name="qnum" type="number" placeholder="Q#" className="field" />

                <textarea name="topic" placeholder="Paste the full question (stem + choices)" required className="field md:col-span-4 min-h-28" />

                <div className="md:col-span-4 flex gap-2 justify-end">
                  {editing && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="btn-outline"
                    >
                      Reset
                    </button>
                  )}
                  <button type="submit" className="btn-gradient">{editing ? "Save Changes" : "Add Entry"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
