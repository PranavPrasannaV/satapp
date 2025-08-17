"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  testId?: string; // Add testId to link questions to specific tests
  userAnswer?: string;
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
  // Remove placeholder word 'blank' and bracketed/parenthesized variants for cleaner display only
  .replace(/\[(?:blank)\]/gi, ' ')
  .replace(/\((?:blank)\)/gi, ' ')
  .replace(/\bblank\b/gi, ' ')
  .replace(/(_+)\s*blank/gi, '$1')
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

export default function TestPage() {
  const params = useParams();
  const router = useRouter();
  const testId = params.testId as string;
  
  const [test, setTest] = useState<PracticeTest | null>(null);
  const [items, setItems] = useState<MissedQuestion[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<Section | "All">("All");
  const [status, setStatus] = useState<Status | "All">("All");
  const [questionFilter, setQuestionFilter] = useState("");
  const [editing, setEditing] = useState<MissedQuestion | null>(null);
  const [activeTab, setActiveTab] = useState<"Overview" | "List">("Overview");
  const [formSection, setFormSection] = useState<Section>("Reading");
  const [formStatus, setFormStatus] = useState<Status>("Reviewing");
  const [formUserAnswer, setFormUserAnswer] = useState<string>("A");
  const [showFilters, setShowFilters] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showAddSuccess, setShowAddSuccess] = useState(false);
  const [closeOnSubmit, setCloseOnSubmit] = useState(false);

  const resetForm = () => {
    setEditing(null);
    setFormSection("Reading");
    setFormStatus("Reviewing");
    setFormUserAnswer("A");
    const form = document.getElementById("entry-form") as HTMLFormElement | null;
    if (form) form.reset();
  }

  // Load test data
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PRACTICE_TESTS_STORAGE_KEY);
      if (stored) {
        const tests: PracticeTest[] = JSON.parse(stored);
        const foundTest = tests.find(t => t.id === testId);
        if (foundTest) {
          setTest(foundTest);
        } else {
          router.push('/');
        }
      } else {
        router.push('/');
      }
    } catch (error) {
      console.error('Error loading test:', error);
      router.push('/');
    }
  }, [testId, router]);

  // Load questions from localStorage
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
            userAnswer: typeof rec.userAnswer === 'string' ? rec.userAnswer : undefined,
          };
        });
        setItems(migrated);
      }
    } catch (error) {
      console.error('Error loading questions:', error);
    } finally {
      setItemsLoaded(true);
    }
  }, []); // Only load once on mount

  // Persist to localStorage
  useEffect(() => {
    if (!itemsLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error('Error saving questions:', error);
    }
  }, [items, itemsLoaded]);

  // Filter questions for this specific test
  const testQuestions = useMemo(() => {
    return items.filter(item => item.testId === testId);
  }, [items, testId]);

  const stats = useMemo(() => {
    const total = testQuestions.length;
    const mastered = testQuestions.filter((i) => i.status === "Mastered").length;
    const reviewing = testQuestions.filter((i) => i.status === "Reviewing").length;
    const bySection = testQuestions.reduce<Record<string, number>>((acc, i) => {
      acc[i.section] = (acc[i.section] ?? 0) + 1;
      return acc;
    }, {});
    return { total, mastered, reviewing, bySection, masteryRate: total ? Math.round((mastered / total) * 100) : 0 };
  }, [testQuestions]);

  // AI bank count (per test scope)
  const aiBankCount = useMemo(() => {
    try {
      const raw = localStorage.getItem("sat-ai-practice-bank-v1");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x: any) => x.testId === testId).length : 0;
    } catch {
      return 0;
    }
  }, [testId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const qQuestion = questionFilter.toLowerCase().trim();
    return testQuestions.filter((i) => {
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
  }, [testQuestions, section, status, search, questionFilter]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const obj: MissedQuestion = {
      id: editing?.id ?? uid(),
      section: formSection,
      topic: (fd.get("topic") as string).trim(),
      source: test?.name || "Unknown Test",
      questionNumber: Number(fd.get("qnum")) || undefined,
      tags: [],
      status: formStatus,
      testId: testId,
  userAnswer: String(fd.get('userAnswer') || formUserAnswer || '').trim() || undefined,
    };
    if (!obj.topic) {
      if (closeOnSubmit) {
        // Done was clicked with empty fields: just close without adding
        (e.currentTarget as HTMLFormElement).reset();
        setEditing(null);
        setShowModal(false);
        setCloseOnSubmit(false);
        setShowAddSuccess(false);
      }
      return;
    }

    setItems((prev) => {
      if (editing) {
        return prev.map((p) => (p.id === editing.id ? obj : p));
      }
      return [obj, ...prev];
    });
    // After adding, either close the modal (Done) or keep it open (Add Question)
    if (editing || closeOnSubmit) {
      // Save-and-close behavior
      e.currentTarget.reset();
      setEditing(null);
      setShowModal(false);
      setCloseOnSubmit(false);
      setShowAddSuccess(false);
    } else {
      // Continuous add behavior: show success, clear fields, keep modal open
      setShowAddSuccess(true);
      // Clear all fields via resetForm to restore defaults
      resetForm();
      // Keep Section/Status defaults already handled by resetForm
      // Ensure the success message remains visible for feedback
    }
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
    setFormSection(item.section);
    setFormStatus(item.status);
  // Ensure the user's originally selected answer is reflected in state (or fallback to 'A')
  setFormUserAnswer(item.userAnswer || 'A');
    setShowModal(true);
  }

  function onDelete(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    if (editing?.id === id) setEditing(null);
  }

  if (!test) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <p className="text-gray-500">Loading test...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card pop-enter">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="text-blue-500 hover:text-blue-700 mb-2 inline-block">
              ← Back to Practice Tests
            </Link>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{test.name}</h1>
                         <p className="text-sm text-black/60 dark:text-white/60 mt-1">
               {test.testNumber ? `Test #${test.testNumber}` : ''}
             </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setShowModal(true); }} className="btn-gradient">+ Add Question</button>
            <Link
              href={`/tests/${test.id}/learn`}
              className="btn-outline"
              onClick={(e) => {
                const count = items.filter((i) => i.testId === test.id).length;
                if (count === 0) {
                  e.preventDefault();
                  alert("You must add at least 1 question to this test before you can practice missed.");
                }
              }}
            >
              Go to Practice
            </Link>
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
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card pop-enter">
              <div className="text-xs text-black/60 dark:text-white/60">Total Questions</div>
              <div className="text-2xl font-semibold mt-1">{stats.total}</div>
            </div>
            <div className="card pop-enter">
              <div className="text-xs text-black/60 dark:text-white/60">Mastery Rate</div>
              <div className="text-2xl font-semibold mt-1">{stats.masteryRate}%</div>
            </div>
            <div className="card pop-enter">
              <div className="text-xs text-black/60 dark:text-white/60">Currently Reviewing</div>
              <div className="text-2xl font-semibold mt-1">{stats.reviewing}</div>
            </div>
          </section>

          {/* AI Practice Bank for this test */}
          <section>
            <div className="card pop-enter flex items-center justify-between">
              <div>
                <div className="text-sm text-black/60 dark:text-white/60">AI Practice Bank</div>
                <div className="text-2xl font-semibold mt-1">{aiBankCount} saved</div>
              </div>
              <Link href={`/tests/${testId}/ai-bank`} className="btn-outline">Open</Link>
            </div>
          </section>

          {/* By Section */}
          {Object.keys(stats.bySection).length > 0 && (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(stats.bySection).map(([sec, count]) => (
                <div key={sec} className="card pop-enter">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{sec}</div>
                    <Badge tone="blue">{count}</Badge>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {activeTab === "List" && (
        <div className="space-y-4">
          {/* Item count */}
          <div className="flex items-center justify-end">
            <div className="text-sm text-black/60 dark:text-white/60">{filtered.length} items</div>
          </div>

          {showFilters && (
            <section className="card pop-enter">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search topic or source..."
                  className="col-span-2 field"
                />
                <FancySelect<Section>
                  value={section}
                  onChange={setSection}
                  options={["All", "Reading", "Math-Calculator", "Math-No-Calculator"] as const}
                  className=""
                />
                <FancySelect<Status>
                  value={status}
                  onChange={setStatus}
                  options={["All", "New", "Reviewing", "Mastered"] as const}
                />
                <input
                  value={questionFilter}
                  onChange={(e) => setQuestionFilter(e.target.value)}
                  placeholder="Question contains... (matches stem or choices)"
                  className="field"
                />
              </div>
            </section>
          )}

          {/* Grouped List */}
          {filtered.length > 0 ? (
            <div className="entry-group pop-enter">
              {filtered.map((i) => (
                <div key={i.id} className="entry-row">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {(() => {
                        const parsed = parseQuestionText(i.topic);
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
                        return <div className="font-medium break-words whitespace-normal">{i.topic}</div>;
                      })()}
                      <div className="mt-1 text-sm text-black/70 dark:text-white/70 break-words whitespace-normal">
                        {i.section} · {i.source}{typeof i.questionNumber === "number" ? ` · Q${i.questionNumber}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 text-sm text-black/80 dark:text-white/80">
                        <span
                          className={`${
                            i.status === "Mastered"
                              ? "bg-emerald-500"
                              : i.status === "Reviewing"
                              ? "bg-amber-500"
                              : "bg-zinc-400 dark:bg-zinc-500"
                          } inline-block h-2.5 w-2.5 rounded-full`}
                          aria-hidden
                        />
                        <span>{i.status}</span>
                      </div>
                      <button onClick={() => onEdit(i)} className="btn-outline">Edit</button>
                      <button onClick={() => onDelete(i.id)} className="btn-outline text-rose-600 dark:text-rose-300 border-rose-300/50">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-black/60 dark:text-white/60 py-12">
              <div className="max-w-md mx-auto">
                <div className="mb-6">
                  <svg className="mx-auto h-12 w-12 text-black/40 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-black/80 dark:text-white/80 mb-2">No questions logged yet</h3>
                <p className="text-black/60 dark:text-white/60 mb-6">Start tracking your missed questions for this practice test.</p>
                <button 
                  onClick={() => { resetForm(); setShowModal(true); }}
                  className="btn-gradient inline-flex items-center"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Your First Question
                </button>
              </div>
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
              <h2 className="text-lg font-semibold">{editing ? "Edit Question" : "Add New Question"}</h2>
              <button className="btn-outline" onClick={() => { setShowModal(false); resetForm(); }}>Close</button>
            </div>
            {!editing && showAddSuccess && (
              <div className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Question added successfully.</div>
            )}
                         <form id="entry-form" onSubmit={onSubmit} className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
               {/* Section */}
               <div>
                 <div className="text-xs text-black/60 dark:text-white/60 mb-1">Section</div>
                 <input type="hidden" name="section" value={formSection} />
                 <FancySelect
                   value={formSection}
                   onChange={(v) => setFormSection(v as Section)}
                   options={["Reading", "Math-Calculator", "Math-No-Calculator"] as const}
                 />
               </div>
               
               {/* Status */}
               <div>
                 <div className="text-xs text-black/60 dark:text-white/60 mb-1">Status</div>
                 <input type="hidden" name="status" value={formStatus} />
                 <FancySelect
                   value={formStatus}
                   onChange={(v) => setFormStatus(v as Status)}
                   options={["Reviewing", "Mastered"] as const}
                 />
               </div>
               
               {/* Source */}
               <div>
                 <div className="text-xs text-black/60 dark:text-white/60 mb-1">Test</div>
                 <input name="source" value={test.name} readOnly className="field bg-gray-100 w-full" />
               </div>
               
               {/* Question Number */}
               <div>
                 <div className="text-xs text-black/60 dark:text-white/60 mb-1">Question #</div>
                 <input name="qnum" type="number" placeholder="Q#" className="field w-full" />
               </div>

               {/* User's Answer */}
               <div>
                 <div className="text-xs text-black/60 dark:text-white/60 mb-1">Your Answer</div>
                 <input type="hidden" name="userAnswer" value={formUserAnswer} />
                 <FancySelect
                   value={formUserAnswer}
                   onChange={(v) => setFormUserAnswer(v as string)}
                   options={["A", "B", "C", "D"] as const}
                 />
               </div>

              <textarea name="topic" placeholder="Paste the full question (stem + choices)" required className="field md:col-span-5 min-h-28 pt-1.5" />

              <div className="md:col-span-5 flex gap-2 justify-end">
                {editing && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="btn-outline"
                  >
                    Reset
                  </button>
                )}
                {!editing && (
                  <button
                    type="submit"
                    onClick={() => setCloseOnSubmit(false)}
                    className="btn-gradient"
                  >
                    Add Question
                  </button>
                )}
                {!editing && (
                  <button
                    type="submit"
                    formNoValidate
                    onClick={() => setCloseOnSubmit(true)}
                    className="btn-outline"
                  >
                    Done
                  </button>
                )}
                {editing && (
                  <button type="submit" className="btn-gradient">Save Changes</button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
