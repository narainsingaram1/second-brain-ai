import { useEffect, useState } from "react";
import { Check, ListChecks, Loader2, MessageCircle, Play, Sparkles, Trash2, X } from "lucide-react";
import type { BrainState, Course, Quiz, QuizQuestion } from "../../types";
import { bestScore, courseLabel, newCard, studyOf, withStudy } from "../../utils/study";
import { gradeShortAnswer } from "../../services/studyAI";
import { DialogBackdrop } from "../workspace/DialogBackdrop";
import type { StudyProps, StudyUpdate } from "./AcademicWorkspace";

export function QuizzesPanel({ state, course, onChange, onAsk, onGenerate, openQuizId, onOpened }: StudyProps & {
  course: Course; onGenerate: () => void; openQuizId?: string; onOpened: () => void;
}) {
  const quizzes = studyOf(state).quizzes.filter((q) => q.courseId === course.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [running, setRunning] = useState<{ quizId: string; only?: string[] } | null>(null);
  useEffect(() => {
    if (openQuizId) { setRunning({ quizId: openQuizId }); onOpened(); }
  }, [openQuizId, onOpened]);
  const live = running && quizzes.find((q) => q.id === running.quizId);

  return (
    <div className="ws-panel">
      <div className="ws-panel-heading">
        <div>
          <h2>Practice quizzes</h2>
          <p>Test yourself, see why each answer is right, then turn what you missed into flashcards.</p>
        </div>
        <button className="ws-button ws-primary" onClick={onGenerate}><Sparkles size={15} />Generate quiz</button>
      </div>
      {quizzes.length ? (
        <ul className="ac-deck-list">
          {quizzes.map((quiz) => {
            const best = bestScore(quiz);
            const last = quiz.attempts[quiz.attempts.length - 1];
            return (
              <li key={quiz.id}>
                <div className="ac-deck-row">
                  <div className="ac-deck-main">
                    <span className="ac-doc-icon ac-kind-quiz"><ListChecks size={15} /></span>
                    <span><strong>{quiz.title}</strong>
                      <small>{quiz.questions.length} questions · {quiz.attempts.length ? `best ${best}% · last ${last.score}/${last.total}` : "not taken yet"}</small></span>
                  </div>
                  <div className="ac-actions">
                    {last?.missed.length ? <button className="ws-button ws-secondary" onClick={() => setRunning({ quizId: quiz.id, only: last.missed })}>Retry {last.missed.length} missed</button> : null}
                    <button className="ws-button ws-primary" onClick={() => setRunning({ quizId: quiz.id })}><Play size={14} />{quiz.attempts.length ? "Retake" : "Start"}</button>
                    <button className="ws-icon-button" aria-label={`Delete ${quiz.title}`} onClick={() => onChange((prev) => withStudy(prev, (s) => ({ quizzes: s.quizzes.filter((q) => q.id !== quiz.id) })))}><Trash2 size={14} /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="ac-empty"><ListChecks size={24} /><strong>No quizzes yet</strong><p>Generate one from your materials, or ask Synapse in chat to write one.</p></div>
      )}
      {live && <QuizRunner state={state} course={course} quiz={live} only={running!.only} onChange={onChange} onAsk={onAsk} onClose={() => setRunning(null)} />}
    </div>
  );
}

type Answer = { correct: boolean; response: string; feedback?: string };

function QuizRunner({ state, course, quiz, only, onChange, onAsk, onClose }: { state: BrainState; course: Course; quiz: Quiz; only?: string[]; onChange: StudyUpdate; onAsk: (p: string) => void; onClose: () => void }) {
  const [questions] = useState<QuizQuestion[]>(() => (only ? quiz.questions.filter((q) => only.includes(q.id)) : quiz.questions));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [draft, setDraft] = useState("");
  const [grading, setGrading] = useState(false);
  const [savedDeck, setSavedDeck] = useState(false);
  const question = questions[index];
  const answer = question ? answers[question.id] : undefined;
  const finished = index >= questions.length;
  const score = Object.values(answers).filter((a) => a.correct).length;
  const missed = questions.filter((q) => answers[q.id] && !answers[q.id].correct);

  const record = (q: QuizQuestion, a: Answer) => setAnswers((all) => ({ ...all, [q.id]: a }));
  const next = () => {
    setDraft("");
    if (index + 1 >= questions.length && !only) {
      // Only full attempts count toward the quiz history.
      onChange((prev) => withStudy(prev, (s) => ({ quizzes: s.quizzes.map((x) => x.id === quiz.id ? { ...x, attempts: [...x.attempts, {
        id: crypto.randomUUID(), at: new Date().toISOString(), score: Object.values(answers).filter((a) => a.correct).length, total: questions.length,
        missed: questions.filter((q) => !answers[q.id]?.correct).map((q) => q.id) }].slice(-20) } : x) })));
    }
    setIndex((i) => i + 1);
  };
  async function checkShort() {
    if (!question || !draft.trim()) return;
    if (!state.openRouterKey) return record(question, { correct: false, response: draft, feedback: "Compare with the model answer below and judge for yourself." });
    setGrading(true);
    try { record(question, { ...(await gradeShortAnswer(question, draft, state.openRouterKey)), response: draft }); }
    catch { record(question, { correct: false, response: draft, feedback: "Automatic grading failed; compare with the model answer below." }); }
    finally { setGrading(false); }
  }
  const missedToDeck = () => {
    const now = new Date().toISOString();
    const cards = missed.map((q) => newCard(q.prompt, q.answer + (q.explanation ? `\n\n${q.explanation}` : ""), q.sourceDocId));
    onChange((prev) => withStudy(prev, (s) => ({ decks: [...s.decks, { id: crypto.randomUUID(), courseId: course.id, title: `Missed: ${quiz.title}`,
      sourceDocIds: quiz.sourceDocIds, cards, createdAt: now, updatedAt: now }] })));
    setSavedDeck(true);
  };

  return (
    <DialogBackdrop label={quiz.title} onClose={onClose} className="ws-overlay">
      <div className="ws-dialog ac-session">
        <div className="ac-session-top">
          <span>{quiz.title}{only ? " · missed questions" : ""}</span>
          <span>{finished ? "Done" : `Question ${index + 1} of ${questions.length}`}</span>
          <button className="ws-icon-button" aria-label="Close quiz" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ac-progress"><span style={{ width: `${(Math.min(index, questions.length) / Math.max(1, questions.length)) * 100}%` }} /></div>
        {!finished && question ? (
          <div className="ac-question">
            <h3>{question.prompt}</h3>
            {question.type === "mcq" ? (
              <div className="ac-choices">
                {question.choices!.map((choice, i) => {
                  const cls = !answer ? "" : i === question.answerIndex ? "is-correct" : answer.response === String(i) ? "is-wrong" : "is-muted";
                  return (
                    <button key={i} className={`ac-choice ${cls}`} disabled={!!answer} onClick={() => record(question, { correct: i === question.answerIndex, response: String(i) })}>
                      <span>{String.fromCharCode(65 + i)}</span>{choice}{cls === "is-correct" && <Check size={15} />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="ac-short">
                <textarea value={answer ? answer.response : draft} disabled={!!answer} rows={3} placeholder="Your answer" onChange={(e) => setDraft(e.target.value)} />
                {!answer && <button className="ws-button ws-primary" disabled={!draft.trim() || grading} onClick={checkShort}>{grading ? <><Loader2 size={14} className="ac-spin" />Checking…</> : "Check answer"}</button>}
              </div>
            )}
            {answer && (
              <div className={`ac-feedback ${answer.correct ? "is-correct" : "is-wrong"}`}>
                <strong>{answer.correct ? "Correct" : "Not quite"}</strong>
                {answer.feedback && <p>{answer.feedback}</p>}
                {question.type === "short" && <p><b>Model answer:</b> {question.answer}</p>}
                {question.explanation && <p>{question.explanation}</p>}
                {question.type === "short" && !answer.correct && <button className="ws-text-button" onClick={() => record(question, { ...answer, correct: true })}>I was right, count it</button>}
              </div>
            )}
            <div className="ac-grades">
              {answer && <button className="ws-button ws-primary" onClick={next}>{index + 1 >= questions.length ? "See results" : "Next question"}</button>}
            </div>
          </div>
        ) : (
          <div className="ac-results">
            <div className="ac-score"><strong>{score}/{questions.length}</strong><span>{Math.round((score / Math.max(1, questions.length)) * 100)}%</span></div>
            {missed.length ? (
              <>
                <p>You missed {missed.length}: {missed.slice(0, 3).map((q) => `“${q.prompt.slice(0, 60)}${q.prompt.length > 60 ? "…" : ""}”`).join(", ")}{missed.length > 3 ? "…" : ""}</p>
                <div className="ac-grades">
                  <button className="ws-button ws-secondary" disabled={savedDeck} onClick={missedToDeck}>{savedDeck ? <><Check size={14} />Deck created</> : "Turn misses into flashcards"}</button>
                  <button className="ws-button ws-secondary" onClick={() => { onAsk(`I just took the "${quiz.title}" practice quiz for ${courseLabel(course)} and missed these:\n${missed.map((q) => `- ${q.prompt} (correct: ${q.answer})`).join("\n")}\nExplain the concepts behind them using my course materials and help me fix the gaps.`); onClose(); }}>
                    <MessageCircle size={14} />Review with Synapse
                  </button>
                </div>
              </>
            ) : <p>Perfect score. Nice work.</p>}
            <div className="ac-grades"><button className="ws-button ws-primary" onClick={onClose}>Done</button></div>
          </div>
        )}
      </div>
    </DialogBackdrop>
  );
}
