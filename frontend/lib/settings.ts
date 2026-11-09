import { z } from "zod";

export const settingsSchema = z.strictObject({
  workspace_name: z.string().trim().min(1, "Enter a workspace name.").max(80),
  timezone: z.string().trim().min(1, "Enter an IANA timezone.").max(64),
});

export type Settings = z.infer<typeof settingsSchema>;
