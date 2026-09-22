import { queryGeneric } from "convex/server";

export const hello = queryGeneric({
  args: {},
  handler: async () => "Hello from Convex!",
});
