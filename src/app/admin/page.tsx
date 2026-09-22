"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api, type Phase } from "@/lib/convex-api";
import { errorMessage, useDeviceId } from "@/lib/device";

const SESSION_KEY = "ten-minutes-admin-session";
const sessionListeners = new Set<() => void>();

function getAdminToken() {
  return window.sessionStorage.getItem(SESSION_KEY);
}

function setAdminToken(token: string | null) {
  if (token) window.sessionStorage.setItem(SESSION_KEY, token);
  else window.sessionStorage.removeItem(SESSION_KEY);
  sessionListeners.forEach((listener) => listener());
}

function useAdminToken() {
  return useSyncExternalStore(
    (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    getAdminToken,
    () => null,
  );
}
const PHASES: { id: Phase; short: string; label: string; description: string }[] = [
  { id: "submission", short: "01", label: "Submissions", description: "Guests submit questions" },
  { id: "moderation", short: "1.5", label: "Review", description: "Approve questions" },
  { id: "voting", short: "02", label: "Question voting", description: "Guests choose favorites" },
  { id: "answering", short: "03", label: "Answer voting", description: "Top 15 get answered" },
  { id: "closed", short: "04", label: "Results", description: "Voting is closed" },
];

export default function AdminPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="center-screen">
        <section className="setup-card">
          <p className="eyebrow">SETUP REQUIRED</p>
          <h1>Connect Convex to use admin.</h1>
        </section>
      </main>
    );
  }

  return <AdminApp />;
}

function AdminApp() {
  const token = useAdminToken();
  const deviceId = useDeviceId();
  if (!deviceId) return <main className="center-screen"><div className="loader" /></main>;
  if (!token) return <AdminLogin deviceId={deviceId} onLogin={(nextToken) => setAdminToken(nextToken)} />;
  return <AdminDashboard token={token} onLogout={() => setAdminToken(null)} />;
}

function AdminLogin({ deviceId, onLogin }: { deviceId: string; onLogin: (token: string) => void }) {
  const login = useMutation(api.adminLogin);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const token = window.crypto.randomUUID();
      const result = await login({ passcode, token, deviceId });
      if (!result.ok) {
        setError("That passcode is incorrect.");
        return;
      }
      onLogin(token);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login-page">
      <form className="admin-login-card" onSubmit={submit}>
        <Link className="brand" href="/">10 MINUTES</Link>
        <div>
          <p className="eyebrow">ADMIN</p>
          <h1>Event control</h1>
          <p className="muted">Enter the admin passcode to continue.</p>
        </div>
        <label htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          className="text-input passcode-input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          autoFocus
        />
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button full-button" disabled={!passcode || busy}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </main>
  );
}

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const state = useQuery(api.getAdminState, { token });
  const logout = useMutation(api.adminLogout);
  const changePhase = useMutation(api.changePhase);
  const moderate = useMutation(api.moderateQuestion);
  const deleteQuestions = useMutation(api.deleteQuestions);
  const [targetPhase, setTargetPhase] = useState<Phase | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  if (!state) return <main className="center-screen"><div className="loader" /></main>;
  if (!state.authorized) {
    return (
      <main className="center-screen">
        <section className="setup-card">
          <h1>Session expired.</h1>
          <button className="primary-button" type="button" onClick={onLogout}>Log in again</button>
        </section>
      </main>
    );
  }

  const currentIndex = PHASES.findIndex((phase) => phase.id === state.phase);
  const targetIndex = PHASES.findIndex((phase) => phase.id === targetPhase);
  const movingBackward = targetIndex >= 0 && targetIndex < currentIndex;
  const pendingCount = state.questions.filter((question) => question.status === "pending").length;
  const approvedCount = state.questions.filter((question) => question.status === "approved").length;
  const selectableQuestionIds = state.questions.slice(0, 50).map((question) => question.id);
  const allSelected = selectableQuestionIds.length > 0 && selectableQuestionIds.every((questionId) => selectedQuestions.includes(questionId));

  async function confirmPhaseChange() {
    if (!targetPhase) return;
    setBusy(true);
    setError("");
    try {
      const result = await changePhase({ token, phase: targetPhase });
      setNotice(
        targetPhase === "answering"
          ? `Answer voting opened with ${result.topQuestionCount} questions.`
          : `Phase changed to ${PHASES.find((phase) => phase.id === targetPhase)?.label}.`,
      );
      setTargetPhase(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function updateQuestion(questionId: string, status: "approved" | "rejected") {
    setPendingQuestion(questionId);
    setError("");
    try {
      await moderate({ token, questionId, status });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPendingQuestion(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.length) return;
    setDeleting(true);
    setError("");
    try {
      const result = await deleteQuestions({ token, questionIds: deleteTarget });
      setSelectedQuestions((current) =>
        current.filter((questionId) => !deleteTarget.includes(questionId)),
      );
      setNotice(
        `${result.deletedCount} ${result.deletedCount === 1 ? "question" : "questions"} permanently deleted.`,
      );
      setDeleteTarget(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  async function signOut() {
    await logout({ token });
    onLogout();
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <Link className="brand" href="/">10 MINUTES</Link>
          <span className="admin-tag">ADMIN</span>
        </div>
        <button className="text-button" type="button" onClick={() => void signOut()}>Log out</button>
      </header>

      <div className="admin-content">
        <section>
          <div className="admin-section-heading">
            <div>
              <p className="eyebrow">EVENT STATUS</p>
              <h1>Choose the live phase</h1>
            </div>
            <span className="live-badge"><span className="live-dot" /> Live</span>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          {notice && <p className="success-message" role="status">✓ {notice}</p>}
          <div className="phase-grid">
            {PHASES.map((phase) => (
              <button
                type="button"
                key={phase.id}
                className={`phase-card ${state.phase === phase.id ? "active" : ""}`}
                onClick={() => state.phase !== phase.id && setTargetPhase(phase.id)}
              >
                <span className="phase-number">{phase.short}</span>
                <strong>{phase.label}</strong>
                <small>{phase.description}</small>
                {state.phase === phase.id && <span className="current-label">CURRENT</span>}
              </button>
            ))}
          </div>
        </section>

        {state.phase === "moderation" && <section className="moderation-panel">
          <div className="admin-section-heading moderation-heading">
            <div>
              <p className="eyebrow">QUESTION REVIEW</p>
              <h2>{pendingCount} waiting for review</h2>
            </div>
            <div className="review-counts"><span>{approvedCount} approved</span><span>{state.questions.length} total</span></div>
          </div>
          {state.questions.length > 0 && (
            <div className="selection-toolbar">
              <label className="select-all-control">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) =>
                    setSelectedQuestions(
                      event.target.checked
                        ? selectableQuestionIds
                        : [],
                    )
                  }
                />
                {state.questions.length > 50 ? "Select first 50" : "Select all"}
              </label>
              <button
                className="danger-button"
                type="button"
                disabled={selectedQuestions.length === 0}
                onClick={() => setDeleteTarget(selectedQuestions)}
              >
                Delete selected ({selectedQuestions.length})
              </button>
            </div>
          )}
          <div className="moderation-list">
            {state.questions.map((question) => (
              <article className={`moderation-card status-${question.status}`} key={question.id}>
                <label className="question-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedQuestions.includes(question.id)}
                    disabled={!selectedQuestions.includes(question.id) && selectedQuestions.length >= 50}
                    onChange={(event) =>
                      setSelectedQuestions((current) =>
                        event.target.checked
                          ? [...current, question.id]
                          : current.filter((questionId) => questionId !== question.id),
                      )
                    }
                  />
                  <span className="sr-only">Select question</span>
                </label>
                <p>{question.text}</p>
                <div className="moderation-actions">
                  <button
                    className={`approve-button ${question.status === "approved" ? "chosen" : ""}`}
                    type="button"
                    disabled={pendingQuestion === question.id}
                    onClick={() => void updateQuestion(question.id, "approved")}
                    aria-label="Approve question"
                  >
                    ✓ <span>Approve</span>
                  </button>
                  <button
                    className={`reject-button ${question.status === "rejected" ? "chosen" : ""}`}
                    type="button"
                    disabled={pendingQuestion === question.id}
                    onClick={() => void updateQuestion(question.id, "rejected")}
                    aria-label="Reject question"
                  >
                    × <span>Reject</span>
                  </button>
                  <button
                    className="delete-button"
                    type="button"
                    disabled={pendingQuestion === question.id}
                    onClick={() => setDeleteTarget([question.id])}
                    aria-label="Permanently delete question"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {state.questions.length === 0 && <div className="empty-state">No questions submitted yet.</div>}
          </div>
        </section>}
      </div>

      {targetPhase && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="phase-confirm-title">
            <p className="eyebrow">CHANGE LIVE PHASE</p>
            <h2 id="phase-confirm-title">Switch to {PHASES.find((phase) => phase.id === targetPhase)?.label}?</h2>
            <p className="muted">Everyone on the site will immediately see this phase.</p>
            {movingBackward && (
              <div className="warning-box">
                <strong>Careful—you’re moving backward.</strong>
                <span>Existing questions, votes, and answers will remain saved.</span>
              </div>
            )}
            {targetPhase === "answering" && (
              <div className="warning-box neutral">
                <strong>The final questions will be frozen.</strong>
                <span>The 15 highest-ranked approved questions will enter answer voting.</span>
              </div>
            )}
            <div className="modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setTargetPhase(null)}>Cancel</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmPhaseChange()}>
                {busy ? "Switching…" : "Yes, switch phase"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
            <p className="eyebrow danger-eyebrow">PERMANENT DELETION</p>
            <h2 id="delete-confirm-title">
              Delete {deleteTarget.length === 1 ? "this question" : `${deleteTarget.length} questions`}?
            </h2>
            <div className="warning-box destructive">
              <strong>This cannot be undone.</strong>
              <span>Every vote and answer attached to {deleteTarget.length === 1 ? "this question" : "these questions"} will also be permanently deleted.</span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="danger-confirm-button" type="button" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
