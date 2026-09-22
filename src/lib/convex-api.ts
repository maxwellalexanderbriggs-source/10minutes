import { makeFunctionReference } from "convex/server";

export type Phase =
  | "submission"
  | "moderation"
  | "voting"
  | "answering"
  | "closed";

export type QuestionSummary = {
  id: string;
  text: string;
  createdAt: number;
  voteCount: number;
  hasVoted: boolean;
};

export type AnswerQuestion = {
  id: string;
  text: string;
  totalAnswers: number;
  selectedPerson: string | null;
  breakdown: { person: string; count: number }[];
};

export type PublicState = {
  phase: Phase;
  questions: QuestionSummary[];
  answerQuestions: AnswerQuestion[];
};

export type AdminState = {
  authorized: boolean;
  phase: Phase;
  questions: { id: string; text: string; status: string }[];
};

export const api = {
  getPublicState: makeFunctionReference<
    "query",
    { deviceId: string },
    PublicState
  >("app:getPublicState"),
  submitQuestion: makeFunctionReference<
    "mutation",
    { text: string; deviceId: string },
    null
  >("app:submitQuestion"),
  toggleQuestionVote: makeFunctionReference<
    "mutation",
    { questionId: string; deviceId: string },
    { voted: boolean }
  >("app:toggleQuestionVote"),
  setAnswer: makeFunctionReference<
    "mutation",
    { questionId: string; deviceId: string; person: string },
    null
  >("app:setAnswer"),
  adminLogin: makeFunctionReference<
    "mutation",
    { passcode: string; token: string; deviceId: string },
    { ok: boolean }
  >("app:adminLogin"),
  adminLogout: makeFunctionReference<
    "mutation",
    { token: string },
    null
  >("app:adminLogout"),
  getAdminState: makeFunctionReference<
    "query",
    { token: string },
    AdminState
  >("app:getAdminState"),
  moderateQuestion: makeFunctionReference<
    "mutation",
    { token: string; questionId: string; status: "approved" | "rejected" },
    null
  >("app:moderateQuestion"),
  deleteQuestions: makeFunctionReference<
    "mutation",
    { token: string; questionIds: string[] },
    { deletedCount: number }
  >("app:deleteQuestions"),
  changePhase: makeFunctionReference<
    "mutation",
    { token: string; phase: Phase },
    { topQuestionCount: number }
  >("app:changePhase"),
};
