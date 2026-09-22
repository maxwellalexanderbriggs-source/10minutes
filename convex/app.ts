import {
  mutationGeneric,
  queryGeneric,
  type GenericDataModel,
  type GenericDatabaseReader,
} from "convex/server";
import { ConvexError, v, type GenericId } from "convex/values";
import { PEOPLE } from "../shared/people";

type ReadContext = { db: GenericDatabaseReader<GenericDataModel> };
type QuestionDoc = {
  _id: GenericId<"questions">;
  text: string;
  createdAt: number;
};
type SettingsDoc = {
  _id: GenericId<"settings">;
  phase: string;
  topQuestionIds: GenericId<"questions">[];
};
type AdminSessionDoc = {
  _id: GenericId<"adminSessions">;
  expiresAt: number;
};

const phaseValidator = v.union(
  v.literal("submission"),
  v.literal("moderation"),
  v.literal("voting"),
  v.literal("answering"),
  v.literal("closed"),
);

async function getSettings(ctx: ReadContext) {
  return (await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique()) as SettingsDoc | null;
}

async function isAdmin(ctx: ReadContext, token: string) {
  if (!token) return false;
  const session = (await ctx.db
    .query("adminSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique()) as AdminSessionDoc | null;
  return Boolean(session && session.expiresAt > Date.now());
}

async function questionWithVotes(
  ctx: ReadContext,
  question: QuestionDoc,
  deviceId: string,
) {
  const votes = await ctx.db
    .query("questionVotes")
    .withIndex("by_question", (q) => q.eq("questionId", question._id))
    .collect();
  return {
    id: question._id,
    text: question.text,
    createdAt: question.createdAt,
    voteCount: votes.length,
    hasVoted: votes.some((vote) => vote.deviceId === deviceId),
  };
}

export const getPublicState = queryGeneric({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const settings = await getSettings(ctx);
    const phase = settings?.phase ?? "submission";

    if (phase === "voting") {
      const approved = await ctx.db
        .query("questions")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .collect();
      const questions = await Promise.all(
        approved.map((question) =>
          questionWithVotes(ctx, question as QuestionDoc, deviceId),
        ),
      );
      questions.sort(
        (a, b) => b.voteCount - a.voteCount || a.createdAt - b.createdAt,
      );
      return { phase, questions, answerQuestions: [] };
    }

    if (phase === "answering" || phase === "closed") {
      const ids = (settings?.topQuestionIds ?? []) as GenericId<"questions">[];
      const answerQuestions = await Promise.all(
        ids.map(async (questionId) => {
          const question = await ctx.db.get(questionId);
          if (!question) return null;
          const answers = await ctx.db
            .query("answers")
            .withIndex("by_question", (q) => q.eq("questionId", questionId))
            .collect();
          const counts = new Map<string, number>();
          for (const answer of answers) {
            counts.set(answer.person, (counts.get(answer.person) ?? 0) + 1);
          }
          const breakdown = [...counts.entries()]
            .map(([person, count]) => ({ person, count }))
            .sort(
              (a, b) => b.count - a.count || a.person.localeCompare(b.person),
            );
          return {
            id: question._id,
            text: question.text,
            totalAnswers: answers.length,
            selectedPerson:
              answers.find((answer) => answer.deviceId === deviceId)?.person ??
              null,
            breakdown,
          };
        }),
      );
      return {
        phase,
        questions: [],
        answerQuestions: answerQuestions.filter(
          (question) => question !== null,
        ),
      };
    }

    return { phase, questions: [], answerQuestions: [] };
  },
});

export const submitQuestion = mutationGeneric({
  args: { text: v.string(), deviceId: v.string() },
  handler: async (ctx, { text, deviceId }) => {
    const settings = await getSettings(ctx);
    if ((settings?.phase ?? "submission") !== "submission") {
      throw new ConvexError("Question submission is closed.");
    }
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned.length < 20 || cleaned.length > 240) {
      throw new ConvexError("Questions must be between 20 and 240 characters.");
    }
    if (!/^who\s+is\s+most\s+likely\s+to\b/i.test(cleaned)) {
      throw new ConvexError('Start your question with “Who is most likely to…”');
    }
    await ctx.db.insert("questions", {
      text: cleaned.endsWith("?") ? cleaned : `${cleaned}?`,
      status: "pending",
      submittedBy: deviceId,
      createdAt: Date.now(),
    });
  },
});

export const toggleQuestionVote = mutationGeneric({
  args: { questionId: v.id("questions"), deviceId: v.string() },
  handler: async (ctx, { questionId, deviceId }) => {
    const settings = await getSettings(ctx);
    if (settings?.phase !== "voting") {
      throw new ConvexError("Question voting is closed.");
    }
    const question = await ctx.db.get(questionId);
    if (!question || question.status !== "approved") {
      throw new ConvexError("Question unavailable.");
    }
    const votes = await ctx.db
      .query("questionVotes")
      .withIndex("by_question", (q) => q.eq("questionId", questionId))
      .collect();
    const existing = votes.find((vote) => vote.deviceId === deviceId);
    if (existing) {
      await ctx.db.delete(existing._id);
      return { voted: false };
    }
    await ctx.db.insert("questionVotes", { questionId, deviceId });
    return { voted: true };
  },
});

export const setAnswer = mutationGeneric({
  args: {
    questionId: v.id("questions"),
    deviceId: v.string(),
    person: v.string(),
  },
  handler: async (ctx, { questionId, deviceId, person }) => {
    const settings = await getSettings(ctx);
    if (settings?.phase !== "answering") {
      throw new ConvexError("Answer voting is closed.");
    }
    if (!settings.topQuestionIds.some((id) => id === questionId)) {
      throw new ConvexError("Question unavailable.");
    }
    if (!(PEOPLE as readonly string[]).includes(person)) {
      throw new ConvexError("Choose a valid person.");
    }
    const answers = await ctx.db
      .query("answers")
      .withIndex("by_question", (q) => q.eq("questionId", questionId))
      .collect();
    const existing = answers.find((answer) => answer.deviceId === deviceId);
    if (existing) {
      await ctx.db.patch(existing._id, { person });
    } else {
      await ctx.db.insert("answers", { questionId, deviceId, person });
    }
  },
});

export const adminLogin = mutationGeneric({
  args: { passcode: v.string(), token: v.string() },
  handler: async (ctx, { passcode, token }) => {
    const configuredPasscode = process.env.ADMIN_PASSCODE;
    if (!configuredPasscode) {
      throw new ConvexError("ADMIN_PASSCODE is not configured in Convex.");
    }
    if (passcode !== configuredPasscode) return { ok: false };
    if (token.length < 24) throw new ConvexError("Invalid session token.");
    await ctx.db.insert("adminSessions", {
      token,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    });
    return { ok: true };
  },
});

export const adminLogout = mutationGeneric({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = (await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()) as AdminSessionDoc | null;
    if (session) await ctx.db.delete(session._id);
  },
});

export const getAdminState = queryGeneric({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!(await isAdmin(ctx, token))) {
      return {
        authorized: false as const,
        phase: "submission",
        questions: [],
      };
    }
    const settings = await getSettings(ctx);
    const questions = await ctx.db.query("questions").order("desc").collect();
    return {
      authorized: true as const,
      phase: settings?.phase ?? "submission",
      questions: questions.map((question) => ({
        id: question._id,
        text: question.text,
        status: question.status,
      })),
    };
  },
});

export const moderateQuestion = mutationGeneric({
  args: {
    token: v.string(),
    questionId: v.id("questions"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
  },
  handler: async (ctx, { token, questionId, status }) => {
    if (!(await isAdmin(ctx, token))) {
      throw new ConvexError("Admin session expired.");
    }
    await ctx.db.patch(questionId, { status });
  },
});

export const changePhase = mutationGeneric({
  args: { token: v.string(), phase: phaseValidator },
  handler: async (ctx, { token, phase }) => {
    if (!(await isAdmin(ctx, token))) {
      throw new ConvexError("Admin session expired.");
    }
    const existing = await getSettings(ctx);
    let topQuestionIds =
      (existing?.topQuestionIds as GenericId<"questions">[] | undefined) ?? [];
    if (phase === "answering" && existing?.phase !== "answering") {
      const approved = await ctx.db
        .query("questions")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .collect();
      const ranked = await Promise.all(
        approved.map(async (question) => ({
          id: question._id as GenericId<"questions">,
          createdAt: question.createdAt as number,
          votes: (
            await ctx.db
              .query("questionVotes")
              .withIndex("by_question", (q) =>
                q.eq("questionId", question._id),
              )
              .collect()
          ).length,
        })),
      );
      ranked.sort(
        (a, b) => b.votes - a.votes || a.createdAt - b.createdAt,
      );
      topQuestionIds = ranked.slice(0, 15).map((question) => question.id);
    }
    if (existing) {
      await ctx.db.patch(existing._id, { phase, topQuestionIds });
    } else {
      await ctx.db.insert("settings", {
        key: "global",
        phase,
        topQuestionIds,
      });
    }
    return { topQuestionCount: topQuestionIds.length };
  },
});
