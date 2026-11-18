import { useEffect, useRef, useState } from "react";
import { Check, MessageCircleQuestion, X } from "lucide-react";
import type { UserAnswers, UserQuestionRequest } from "../services/askUser";

/**
 * Questions the assistant needs answered to carry on, asked mid-task. Each one has choices to tap (one, or
 * several when allowed) and a box for a short answer of the user's own. The turn waits on this card and then
 * continues where it was: open tabs and progress stay as they are.
 */
export function AskUserCard({ request, onAnswer }: { request: UserQuestionRequest; onAnswer: (answers: UserAnswers | null) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const first = useRef<HTMLElement | null>(null);
  useEffect(() => { setPicked({}); setTyped({}); first.current?.focus({ preventScroll: true }); }, [request.id]);

  const answerOf = (id: string) => [...(picked[id] || []), typed[id]?.trim() || ""].filter(Boolean).join(", ");
  const answered = request.questions.filter(q => answerOf(q.id)).length;
  const single = request.questions.length === 1 && !request.questions[0].multiple;
  const submit = (override?: UserAnswers) => {
    const answers: UserAnswers = override ?? {};
    if (!override) for (const q of request.questions) { const a = answerOf(q.id); if (a) answers[q.id] = a; }
    onAnswer(answers);
  };
  const choose = (id: string, choice: string, multiple?: boolean) => {
    // One question with one answer: tapping a choice is the answer.
    if (single) { submit({ [id]: choice }); return; }
    setPicked(current => {
      const now = current[id] || [];
      const next = multiple ? (now.includes(choice) ? now.filter(c => c !== choice) : [...now, choice]) : (now[0] === choice ? [] : [choice]);
      return { ...current, [id]: next };
    });
    if (!multiple) setTyped(current => ({ ...current, [id]: "" }));
  };

  return <section className="approval-card is-pending ask-user" role="dialog" aria-label="Iris has a question">
    <header><MessageCircleQuestion size={15} aria-hidden="true" /><strong>{request.context || (request.questions.length > 1 ? "A few things I need to know" : "I need to know one thing")}</strong></header>
    <form className="ask-user-form" onSubmit={event => { event.preventDefault(); if (answered) submit(); }}>
      {request.questions.map((q, index) => <fieldset key={q.id} className="ask-user-question">
        <legend>{q.question}</legend>
        {q.choices && <div className="ask-user-choices" role={q.multiple ? "group" : "radiogroup"} aria-label={q.question}>
          {q.choices.map((choice, i) => {
            const on = (picked[q.id] || []).includes(choice);
            return <button key={choice} type="button" ref={index === 0 && i === 0 ? el => { first.current = el; } : undefined}
              className={`ask-user-choice${on ? " is-on" : ""}`} role={q.multiple ? "checkbox" : "radio"} aria-checked={on}
              onClick={() => choose(q.id, choice, q.multiple)}>{q.multiple && on && <Check size={12} aria-hidden="true" />}{choice}</button>;
          })}
        </div>}
        <input type="text" className="ask-user-input" value={typed[q.id] || ""} aria-label={q.choices ? `${q.question}: another answer` : q.question}
          ref={index === 0 && !q.choices ? el => { first.current = el; } : undefined}
          placeholder={q.placeholder || (q.choices ? "Or type another answer" : "Type your answer")}
          onChange={event => { const value = event.target.value; setTyped(current => ({ ...current, [q.id]: value })); if (value && !q.multiple) setPicked(current => ({ ...current, [q.id]: [] })); }} />
      </fieldset>)}
      <div className="approval-actions">
        <button type="submit" className="approval-approve" disabled={!answered}><Check size={14} />{request.questions.length > 1 && answered < request.questions.length ? `Send ${answered} of ${request.questions.length}` : "Send"}</button>
        <button type="button" className="approval-reject" onClick={() => submit({})}>Skip</button>
        <button type="button" className="approval-reject" onClick={() => onAnswer(null)}><X size={14} />Not now</button>
      </div>
    </form>
  </section>;
}
