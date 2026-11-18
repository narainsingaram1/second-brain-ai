// The question card the assistant shows mid-task, with synthetic questions. Answers are printed below it.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/chat.css";
import "../../src/index.css";
import "../../src/redesign.css";
import { AskUserCard } from "../../src/components/AskUserCard";
import type { UserAnswers } from "../../src/services/askUser";

const request = { id: "fixture", context: "For your internship application at Example Co.", questions: [
  { id: "q1", question: "Will you need visa sponsorship?", choices: ["Yes", "No"] },
  { id: "q2", question: "Which programming languages do you use most?", choices: ["Python", "TypeScript", "Java", "C++", "Go"], multiple: true },
  { id: "q3", question: "What's your phone number?", placeholder: "(555) 123-4567" },
] };

function Fixture() {
  const [answers, setAnswers] = useState<UserAnswers | null | undefined>(undefined);
  return <div className="chat-workspace" style={{ maxWidth: 720, margin: "24px auto", padding: "0 16px" }}>
    <AskUserCard request={request} onAnswer={setAnswers} />
    <pre id="answers" style={{ marginTop: 16 }}>{answers === undefined ? "" : JSON.stringify(answers)}</pre>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
