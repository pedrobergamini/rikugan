import { z } from "zod";

export const groupSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  reviewFocus: z.array(z.string()).optional(),
  risk: z.enum(["low", "medium", "high"]),
  hunkIds: z.array(z.string()),
  suggestedTests: z.array(z.string()).optional()
});

export const groupsSchema = z.object({
  groups: z.array(groupSchema)
});

export const annotationSchema = z.object({
  id: z.string(),
  kind: z.enum(["explain", "risk", "question", "test", "nit"]),
  confidence: z.number().min(0).max(1),
  title: z.string(),
  bodyMarkdown: z.string(),
  anchor: z.object({
    filePath: z.string(),
    side: z.enum(["old", "new"]),
    line: z.number().int().positive(),
    hunkId: z.string().optional()
  }),
  actions: z
    .array(
      z.object({
        label: z.string(),
        action: z.literal("openChat"),
        scope: z.enum(["group", "file", "repo"])
      })
    )
    .optional()
});

export const annotationsSchema = z.object({
  annotations: z.array(annotationSchema)
});

export const findingSchema = z.object({
  id: z.string(),
  kind: z.enum(["bug", "flag"]),
  severity: z.enum(["severe", "normal"]).optional(),
  flagClass: z.enum(["investigate", "informational"]).optional(),
  confidence: z.number().min(0).max(1),
  title: z.string(),
  detailMarkdown: z.string(),
  evidence: z.array(
    z.object({
      filePath: z.string(),
      side: z.enum(["old", "new"]).optional(),
      lineRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
      hunkId: z.string().optional(),
      excerpt: z.string().optional()
    })
  ),
  status: z.enum(["open", "resolved", "dismissed"])
});

export const findingsSchema = z.object({
  findings: z.array(findingSchema)
});

export const contextNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  bodyMarkdown: z.string(),
  confidence: z.number().min(0).max(1),
  groupId: z.string(),
  hunkIds: z.array(z.string())
});

export const reviewSchema = z.object({
  findings: z.array(findingSchema),
  contextNotes: z.array(contextNoteSchema)
});
