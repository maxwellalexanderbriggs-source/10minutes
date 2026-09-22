import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  settings: defineTable({
    key: v.string(),
    phase: v.string(),
    topQuestionIds: v.array(v.id("questions")),
  }).index("by_key", ["key"]),

  questions: defineTable({
    text: v.string(),
    status: v.string(),
    submittedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_submitter", ["submittedBy"]),

  questionVotes: defineTable({
    questionId: v.id("questions"),
    deviceId: v.string(),
  })
    .index("by_question", ["questionId"])
    .index("by_question_device", ["questionId", "deviceId"]),

  answers: defineTable({
    questionId: v.id("questions"),
    deviceId: v.string(),
    person: v.string(),
  })
    .index("by_question", ["questionId"])
    .index("by_question_device", ["questionId", "deviceId"]),

  adminSessions: defineTable({
    token: v.string(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expiry", ["expiresAt"]),

  adminLoginAttempts: defineTable({
    deviceId: v.string(),
    attemptedAt: v.number(),
  }).index("by_device", ["deviceId"]),
});
