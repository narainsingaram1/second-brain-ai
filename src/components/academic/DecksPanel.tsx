import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers, MessageCircle, Play, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import type { Course, FlashcardDeck } from "../../types";
import { getLocalDateString } from "../../utils/habitStreaks";
import { courseLabel, dueCards, newCard, reviewCard, studyOf, withStudy, type Grade } from "../../utils/study";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import type { StudyProps, StudyUpdate } from "./AcademicWorkspace";

export function DecksPanel({ state, course, onChange, onAsk, onGenerate, openDeckId, onOpened }: StudyProps & {
  course: Course; onGenerate: () => void; openDeckId?: string; onOpened: () => void;
}) {
  const study = studyOf(state);
  const decks = study.decks.filter((d) => d.courseId === course.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const today = getLocalDateString();
  const [session, setSession] = useState<{ deckId: string; all: boolean } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(openDeckId || null);
  useEffect(() => {
    if (openDeckId) { setExpanded(openDeckId); onOpened(); }
  }, [openDeckId, onOpened]);
  const updateDeck = (id: string, change: (deck: FlashcardDeck) => FlashcardDeck) =>
    onChange((prev) => withStudy(prev, (s) => ({ decks: s.decks.map((d) => (d.id === id ? { ...change(d), updatedAt: new Date().toISOString() } : d)) })));
  const docName = (id?: string) => (id ? study.documents.find((d) => d.id === id)?.name : undefined);
  const live = session && decks.find((d) => d.id === session.deckId);

  return (
    <div className="ws-panel">
      <div className="ws-panel-heading">
        <div>
          <h2>Flashcard decks</h2>
          <p>Cards come back on a spaced-repetition schedule: the better you know one, the longer until you see it again.</p>
        </div>
        <button className="ws-button ws-primary" onClick={onGenerate}><Sparkles size={15} />Generate deck</button>
      </div>
      {decks.length ? (
        <ul className="ac-deck-list">
          {decks.map((deck) => {
            const due = dueCards(deck, today).length;
            const isOpen = expanded === deck.id;
            return (
              <li key={deck.id}>
                <div className="ac-deck-row">
                  <button className="ac-deck-main" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : deck.id)}>
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <span className="ac-doc-icon ac-kind-deck"><Layers size={15} /></span>
                    <span><strong>{deck.title}</strong><small>{deck.cards.length} cards · {due ? <b className="ac-due">{due} due today</b> : "nothing due"}{deck.sourceDocIds.length ? ` · from ${deck.sourceDocIds.length} document${deck.sourceDocIds.length === 1 ? "" : "s"}` : ""}</small></span>
                  </button>
                  <div className="ac-actions">
                    <button className="ws-button ws-primary" disabled={!due} onClick={() => setSession({ deckId: deck.id, all: false })}><Play size={14} />Study {due || ""}</button>
                    <button className="ws-button ws-secondary" disabled={!deck.cards.length} onClick={() => setSession({ deckId: deck.id, all: true })}><RotateCcw size={14} />All</button>
                    <button className="ws-icon-button" aria-label={`Delete ${deck.title}`} onClick={() => onChange((prev) => withStudy(prev, (s) => ({ decks: s.decks.filter((d) => d.id !== deck.id) })))}><Trash2 size={14} /></button>
                  </div>
                </div>
                {isOpen && <DeckCards deck={deck} docName={docName} onUpdate={(change) => updateDeck(deck.id, change)}
                  onAsk={() => onAsk(`Quiz me on my "${deck.title}" flashcards for ${courseLabel(course)}, one question at a time, and explain anything I get wrong.`)} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="ac-empty"><Layers size={24} /><strong>No decks yet</strong><p>Select materials and generate a deck, or ask Synapse in chat to make one.</p></div>
      )}
      {live && <StudySession deck={live} all={session!.all} onChange={onChange} docName={docName} onClose={() => setSession(null)} />}
    </div>
  );
}

function DeckCards({ deck, docName, onUpdate, onAsk }: { deck: FlashcardDeck; docName: (id?: string) => string | undefined; onUpdate: (c: (d: FlashcardDeck) => FlashcardDeck) => void; onAsk: () => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  return (
    <div className="ac-card-table">
      {deck.cards.map((card) => (
        <div key={card.id} className="ac-card-line">
          <div><strong>{card.front}</strong><p>{card.back}</p>{docName(card.sourceDocId) && <small>{docName(card.sourceDocId)}</small>}</div>
          <small className="ac-card-due">{card.reps ? `next ${new Date(`${card.due}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "new"}</small>
          <button className="ws-icon-button" aria-label="Delete card" onClick={() => onUpdate((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== card.id) }))}><X size={13} /></button>
        </div>
      ))}
      <form className="ac-add-card" onSubmit={(e) => {
        e.preventDefault();
        if (!front.trim() || !back.trim()) return;
        onUpdate((d) => ({ ...d, cards: [...d.cards, newCard(front, back)] }));
        setFront(""); setBack("");
      }}>
        <input value={front} maxLength={2000} placeholder="Front" aria-label="New card front" onChange={(e) => setFront(e.target.value)} />
        <input value={back} maxLength={2000} placeholder="Back" aria-label="New card back" onChange={(e) => setBack(e.target.value)} />
        <button className="ws-button ws-secondary" disabled={!front.trim() || !back.trim()}><Plus size={14} />Add</button>
        <button type="button" className="ws-button ws-secondary" onClick={onAsk}><MessageCircle size={14} />Drill in chat</button>
      </form>
    </div>
  );
}

const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: "again", label: "Again", key: "1" },
  { grade: "hard", label: "Hard", key: "2" },
  { grade: "good", label: "Good", key: "3" },
  { grade: "easy", label: "Easy", key: "4" },
];

function StudySession({ deck, all, onChange, docName, onClose }: { deck: FlashcardDeck; all: boolean; onChange: StudyUpdate; docName: (id?: string) => string | undefined; onClose: () => void }) {
  // The queue is fixed when the session starts; "again" cards return to the end of it.
  const initial = useMemo(() => (all ? deck.cards : dueCards(deck)).map((c) => c.id), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [queue, setQueue] = useState(initial);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const card = deck.cards.find((c) => c.id === queue[0]);

  const grade = (g: Grade) => {
    if (!card) return;
    const reviewed = reviewCard(card, g);
    onChange((prev) => withStudy(prev, (s) => ({ decks: s.decks.map((d) => d.id === deck.id
      ? { ...d, updatedAt: new Date().toISOString(), cards: d.cards.map((c) => (c.id === card.id ? reviewed : c)) } : d) })));
    setQueue((q) => (g === "again" ? [...q.slice(1), q[0]] : q.slice(1)));
    if (g !== "again") setDone((n) => n + 1);
    setFlipped(false);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      const match = GRADES.find((g) => g.key === e.key);
      if (match && flipped) grade(match.grade);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <DialogBackdrop label={`Study ${deck.title}`} onClose={onClose} className="ws-overlay">
      <div className="ws-dialog ac-session">
        <div className="ac-session-top">
          <span>{deck.title}</span>
          <span>{done} reviewed · {queue.length} left</span>
          <button className="ws-icon-button" aria-label="End session" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-progress"><span style={{ width: `${initial.length ? Math.min(100, (done / initial.length) * 100) : 100}%` }} /></div>
        {card ? (
          <>
            <button className={`ac-flashcard ${flipped ? "is-flipped" : ""}`} onClick={() => setFlipped((f) => !f)} aria-live="polite">
              <small>{flipped ? "Answer" : "Question"}</small>
              <strong>{card.front}</strong>
              {flipped && <p>{card.back}</p>}
              {flipped && docName(card.sourceDocId) && <em>{docName(card.sourceDocId)}</em>}
              {!flipped && <span className="ac-hint">Click or press Space to reveal</span>}
            </button>
            <div className="ac-grades">
              {flipped ? GRADES.map((g) => (
                <button key={g.grade} className={`ws-button ac-grade-${g.grade}`} onClick={() => grade(g.grade)}>{g.label}<kbd>{g.key}</kbd></button>
              )) : <button className="ws-button ws-primary" onClick={() => setFlipped(true)}>Show answer<kbd>Space</kbd></button>}
            </div>
          </>
        ) : (
          <div className="ac-empty"><Sparkles size={24} /><strong>Session complete</strong><p>{done} cards reviewed. They’ll come back when they’re due.</p>
            <button className="ws-button ws-primary" onClick={onClose}>Done</button></div>
        )}
      </div>
    </DialogBackdrop>
  );
}
