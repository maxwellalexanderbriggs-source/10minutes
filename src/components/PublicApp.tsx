"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api, type AnswerQuestion, type QuestionSummary } from "@/lib/convex-api";
import { errorMessage, useDeviceId } from "@/lib/device";
import { PersonPicker } from "./PersonPicker";

const PHASE_LABELS = {
  submission: "Questions open",
  moderation: "Under review",
  voting: "Question voting",
  answering: "Answer voting",
  closed: "Final results",
};

export function PublicApp() {
  const deviceId = useDeviceId();
  const state = useQuery(
    api.getPublicState,
    deviceId ? { deviceId } : "skip",
  );

  if (!deviceId || !state) return <LoadingScreen />;

  return (
    <main className="site-shell">
      <header className="site-header">
        <Link className="brand" href="/">10 MINUTES</Link>
        <span className="phase-pill">{PHASE_LABELS[state.phase]}</span>
      </header>

      {state.phase === "submission" && <Submission deviceId={deviceId} />}
      {state.phase === "moderation" && <ReviewHolding />}
      {state.phase === "voting" && (
        <QuestionVoting deviceId={deviceId} questions={state.questions} />
      )}
      {state.phase === "answering" && (
        <AnswerVoting
          deviceId={deviceId}
          questions={state.answerQuestions}
        />
      )}
      {state.phase === "closed" && (
        <FinalResults questions={state.answerQuestions} />
      )}
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="center-screen">
      <div className="loader" aria-label="Loading" />
    </main>
  );
}

function Submission({ deviceId }: { deviceId: string }) {
  const submitQuestion = useMutation(api.submitQuestion);
  const [text, setText] = useState("Who is most likely to ");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const cleanText = text.trim();
  const valid = /^who\s+is\s+most\s+likely\s+to\b/i.test(cleanText) && cleanText.length >= 20;

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await submitQuestion({ text: cleanText, deviceId });
      setText("Who is most likely to ");
      setConfirming(false);
      setNotice("Your question was submitted for review.");
    } catch (caught) {
      setError(errorMessage(caught));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="hero narrow">
      <p className="eyebrow">EL PASO</p>
      <h1>Ask the question everyone wants answered.</h1>
      <p className="lead">
        Submit a <strong>“Who is most likely to…”</strong> question. You can
        send as many as you like.
      </p>

      <div className="submission-card">
        <label htmlFor="question">Your question</label>
        <textarea
          id="question"
          value={text}
          maxLength={240}
          rows={5}
          onChange={(event) => {
            setText(event.target.value);
            setNotice("");
          }}
        />
        <div className="field-meta">
          <span>Must begin with “Who is most likely to…”</span>
          <span>{text.length}/240</span>
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {notice && <p className="success-message" role="status">✓ {notice}</p>}
        <button
          className="primary-button full-button"
          type="button"
          disabled={!valid}
          onClick={() => setConfirming(true)}
        >
          Submit question
        </button>
      </div>

      {confirming && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="eyebrow">ONE LAST LOOK</p>
            <h2 id="confirm-title">Submit this question?</h2>
            <blockquote>{cleanText.endsWith("?") ? cleanText : `${cleanText}?`}</blockquote>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setConfirming(false)}>
                Go back
              </button>
              <button className="primary-button" type="button" disabled={submitting} onClick={() => void submit()}>
                {submitting ? "Submitting…" : "Yes, submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewHolding() {
  return (
    <section className="center-content narrow">
      <div className="status-icon">✓</div>
      <p className="eyebrow">SUBMISSIONS CLOSED</p>
      <h1>Questions are being reviewed.</h1>
      <p className="lead">Voting will open soon. Keep this page open—it will update automatically.</p>
    </section>
  );
}

function QuestionVoting({ deviceId, questions }: { deviceId: string; questions: QuestionSummary[] }) {
  const toggleVote = useMutation(api.toggleQuestionVote);
  const latest = useRef(questions);
  const [order, setOrder] = useState(() => questions.map((question) => question.id));
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    latest.current = questions;
  }, [questions]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setOrder(latest.current.map((question) => question.id));
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const newIds = questions.map((question) => question.id).filter((id) => !order.includes(id));
  const displayed = [...order, ...newIds]
    .map((id) => questionMap.get(id))
    .filter((question): question is QuestionSummary => Boolean(question));

  async function vote(questionId: string) {
    setPending((current) => [...current, questionId]);
    setError("");
    try {
      await toggleVote({ questionId, deviceId });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending((current) => current.filter((id) => id !== questionId));
    }
  }

  return (
    <section className="content-column">
      <div className="section-heading">
        <p className="eyebrow">PICK YOUR FAVORITES</p>
        <h1>Which questions should make the final 15?</h1>
        <p className="lead">Tap as many as you like. Tap again to remove your vote.</p>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="question-list">
        {displayed.map((question, index) => (
          <button
            className={`vote-card ${question.hasVoted ? "selected" : ""}`}
            type="button"
            aria-pressed={question.hasVoted}
            disabled={pending.includes(question.id)}
            key={question.id}
            onClick={() => void vote(question.id)}
          >
            <span className="rank">{index + 1}</span>
            <span className="question-copy">{question.text}</span>
            <span className="vote-count">
              <span aria-hidden="true">♥</span> {question.voteCount}
            </span>
          </button>
        ))}
        {displayed.length === 0 && <EmptyState text="No questions were approved." />}
      </div>
      <p className="quiet-note">Rankings refresh every few seconds to keep the list steady.</p>
    </section>
  );
}

function AnswerVoting({ deviceId, questions }: { deviceId: string; questions: AnswerQuestion[] }) {
  const setAnswer = useMutation(api.setAnswer);
  const [error, setError] = useState("");

  return (
    <section className="content-column">
      <div className="section-heading">
        <p className="eyebrow">THE FINAL 15</p>
        <h1>Who is most likely?</h1>
        <p className="lead">Choose one person for every question. You can change your answers until voting closes.</p>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="answer-list">
        {questions.map((question, index) => {
          const leaders = getLeaders(question);
          return (
            <article className="answer-card" key={question.id}>
              <div className="question-number">{String(index + 1).padStart(2, "0")}</div>
              <h2>{question.text}</h2>
              <PersonPicker
                selected={question.selectedPerson}
                onSelect={async (person) => {
                  setError("");
                  try {
                    await setAnswer({ questionId: question.id, deviceId, person });
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                }}
              />
              <p className="live-result">
                <span className="live-dot" />
                {question.totalAnswers === 0
                  ? "Waiting for the first answer"
                  : `${leaders.length > 1 ? "Leaders" : "Leader"}: ${leaders.join(" · ")} — ${question.breakdown[0]?.count ?? 0} of ${question.totalAnswers}`}
              </p>
            </article>
          );
        })}
        {questions.length === 0 && <EmptyState text="No questions reached the final round." />}
      </div>
    </section>
  );
}

function FinalResults({ questions }: { questions: AnswerQuestion[] }) {
  return (
    <section className="content-column results-column">
      <div className="section-heading">
        <p className="eyebrow">VOTING CLOSED</p>
        <h1>The results are in.</h1>
        <p className="lead">Here’s who everyone chose.</p>
      </div>
      <div className="answer-list">
        {questions.map((question, index) => (
          <ResultCard question={question} index={index} key={question.id} />
        ))}
        {questions.length === 0 && <EmptyState text="There are no final results yet." />}
      </div>
    </section>
  );
}

const CHART_COLORS = ["#ef5b3f", "#275dff", "#f5b82e", "#2ca58d", "#8a5cf5", "#ef77a8", "#19323c"];

function ResultCard({ question, index }: { question: AnswerQuestion; index: number }) {
  const leaders = getLeaders(question);
  const visible = question.breakdown.filter(
    (item) => question.totalAnswers > 0 && (item.count / question.totalAnswers) * 100 > 5,
  );
  const chart = visible.reduce(
    (current, item, colorIndex) => {
      const end = current.cursor + (item.count / question.totalAnswers) * 100;
      return {
        cursor: end,
        segments: [
          ...current.segments,
          `${CHART_COLORS[colorIndex % CHART_COLORS.length]} ${current.cursor}% ${end}%`,
        ],
      };
    },
    { cursor: 0, segments: [] as string[] },
  );
  const segments =
    chart.cursor < 100
      ? [...chart.segments, `#ecebe7 ${chart.cursor}% 100%`]
      : chart.segments;

  return (
    <article className="result-card">
      <div className="result-copy">
        <p className="question-number">{String(index + 1).padStart(2, "0")}</p>
        <h2>{question.text}</h2>
        <p className="winner-label">{leaders.length > 1 ? "TIE" : "WINNER"}</p>
        <p className="winner-name">{leaders.length ? leaders.join(" & ") : "No votes"}</p>
        <p className="result-total">{question.totalAnswers} total {question.totalAnswers === 1 ? "vote" : "votes"}</p>
      </div>
      <div className="chart-area">
        <div
          className="pie-chart"
          aria-label="Vote breakdown"
          style={{ background: `conic-gradient(${segments.join(", ") || "#ecebe7 0 100%"})` }}
        >
          <div className="pie-center">{question.totalAnswers}</div>
        </div>
        <div className="chart-legend">
          {visible.map((item, colorIndex) => (
            <div className="legend-row" key={item.person}>
              <span className="legend-color" style={{ background: CHART_COLORS[colorIndex % CHART_COLORS.length] }} />
              <span>{item.person}</span>
              <strong>{Math.round((item.count / question.totalAnswers) * 100)}%</strong>
            </div>
          ))}
          {question.totalAnswers > 0 && visible.length === 0 && (
            <p className="quiet-note">No one received more than 5%.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function getLeaders(question: AnswerQuestion) {
  const topCount = question.breakdown[0]?.count ?? 0;
  return topCount
    ? question.breakdown.filter((item) => item.count === topCount).map((item) => item.person)
    : [];
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
