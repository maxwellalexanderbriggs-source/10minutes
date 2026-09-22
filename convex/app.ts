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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBMISSION_WINDOW_MS = 60_000;
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 5 * 60_000;
const MAX_LOGIN_ATTEMPTS = 5;

function assertDeviceId(deviceId: string) {
  if (!UUID_PATTERN.test(deviceId)) {
    throw new ConvexError("Invalid browser identifier. Refresh and try again.");
  }
}

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
  const uniqueVoters = new Set(votes.map((vote) => vote.deviceId as string));
  return {
    id: question._id,
    text: question.text,
    createdAt: question.createdAt,
    voteCount: uniqueVoters.size,
    hasVoted: uniqueVoters.has(deviceId),
  };
}

export const getPublicState = queryGeneric({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    assertDeviceId(deviceId);
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
          const answersByDevice = new Map<string, (typeof answers)[number]>();
          for (const answer of answers) {
            answersByDevice.set(answer.deviceId as string, answer);
          }
          const uniqueAnswers = [...answersByDevice.values()];
          const counts = new Map<string, number>();
          for (const answer of uniqueAnswers) {
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
            totalAnswers: uniqueAnswers.length,
            selectedPerson:
              answersByDevice.get(deviceId)?.person ?? null,
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
    assertDeviceId(deviceId);
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
    const recentQuestions = await ctx.db
      .query("questions")
      .withIndex("by_submitter", (q) => q.eq("submittedBy", deviceId))
      .collect();
    const cutoff = Date.now() - SUBMISSION_WINDOW_MS;
    const recent = recentQuestions.filter(
      (question) => (question.createdAt as number) >= cutoff,
    );
    if (recent.length >= MAX_SUBMISSIONS_PER_WINDOW) {
      throw new ConvexError("You’re submitting too quickly. Try again in a minute.");
    }
    const finalText = cleaned.endsWith("?") ? cleaned : `${cleaned}?`;
    if (
      recent.some(
        (question) =>
          (question.text as string).toLocaleLowerCase() ===
          finalText.toLocaleLowerCase(),
      )
    ) {
      throw new ConvexError("You already submitted that question.");
    }
    await ctx.db.insert("questions", {
      text: finalText,
      status: "pending",
      submittedBy: deviceId,
      createdAt: Date.now(),
    });
  },
});

export const toggleQuestionVote = mutationGeneric({
  args: { questionId: v.id("questions"), deviceId: v.string() },
  handler: async (ctx, { questionId, deviceId }) => {
    assertDeviceId(deviceId);
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
    const existing = votes.filter((vote) => vote.deviceId === deviceId);
    if (existing.length > 0) {
      for (const vote of existing) await ctx.db.delete(vote._id);
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
    assertDeviceId(deviceId);
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
    const existing = answers.filter((answer) => answer.deviceId === deviceId);
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, { person });
      for (const duplicate of existing.slice(1)) {
        await ctx.db.delete(duplicate._id);
      }
    } else {
      await ctx.db.insert("answers", { questionId, deviceId, person });
    }
  },
});

export const adminLogin = mutationGeneric({
  args: { passcode: v.string(), token: v.string(), deviceId: v.string() },
  handler: async (ctx, { passcode, token, deviceId }) => {
    assertDeviceId(deviceId);
    const configuredPasscode = process.env.ADMIN_PASSCODE;
    if (!configuredPasscode) {
      throw new ConvexError("ADMIN_PASSCODE is not configured in Convex.");
    }
    if (!UUID_PATTERN.test(token)) throw new ConvexError("Invalid session token.");
    const attempts = await ctx.db
      .query("adminLoginAttempts")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .collect();
    const loginCutoff = Date.now() - LOGIN_WINDOW_MS;
    const recentAttempts = [];
    for (const attempt of attempts) {
      if ((attempt.attemptedAt as number) >= loginCutoff) {
        recentAttempts.push(attempt);
      } else {
        await ctx.db.delete(attempt._id);
      }
    }
    if (recentAttempts.length >= MAX_LOGIN_ATTEMPTS) {
      throw new ConvexError("Too many attempts. Wait five minutes and try again.");
    }
    if (passcode !== configuredPasscode) {
      await ctx.db.insert("adminLoginAttempts", {
        deviceId,
        attemptedAt: Date.now(),
      });
      return { ok: false };
    }
    for (const attempt of attempts) await ctx.db.delete(attempt._id);
    const expiredSessions = await ctx.db
      .query("adminSessions")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
      .take(100);
    for (const session of expiredSessions) await ctx.db.delete(session._id);
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
    const questions =
      (settings?.phase ?? "submission") === "moderation"
        ? await ctx.db.query("questions").order("desc").collect()
        : [];
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
    const settings = await getSettings(ctx);
    if (settings?.phase !== "moderation") {
      throw new ConvexError("Questions can only be reviewed during the review phase.");
    }
    const question = await ctx.db.get(questionId);
    if (!question) throw new ConvexError("That question no longer exists.");
    await ctx.db.patch(questionId, { status });
  },
});

export const deleteQuestions = mutationGeneric({
  args: { token: v.string(), questionIds: v.array(v.id("questions")) },
  handler: async (ctx, { token, questionIds }) => {
    if (!(await isAdmin(ctx, token))) {
      throw new ConvexError("Admin session expired.");
    }
    const settings = await getSettings(ctx);
    if (settings?.phase !== "moderation") {
      throw new ConvexError("Questions can only be deleted during the review phase.");
    }
    const uniqueQuestionIds = [...new Set(questionIds)];
    if (uniqueQuestionIds.length === 0 || uniqueQuestionIds.length > 50) {
      throw new ConvexError("Select between 1 and 50 questions to delete.");
    }

    let deletedCount = 0;
    for (const questionId of uniqueQuestionIds) {
      const question = await ctx.db.get(questionId);
      if (!question) continue;
      const votes = await ctx.db
        .query("questionVotes")
        .withIndex("by_question", (q) => q.eq("questionId", questionId))
        .collect();
      const answers = await ctx.db
        .query("answers")
        .withIndex("by_question", (q) => q.eq("questionId", questionId))
        .collect();
      for (const vote of votes) await ctx.db.delete(vote._id);
      for (const answer of answers) await ctx.db.delete(answer._id);
      await ctx.db.delete(questionId);
      deletedCount += 1;
    }

    if (settings) {
      const deletedIds = new Set(uniqueQuestionIds.map(String));
      await ctx.db.patch(settings._id, {
        topQuestionIds: settings.topQuestionIds.filter(
          (questionId) => !deletedIds.has(String(questionId)),
        ),
      });
    }
    return { deletedCount };
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
