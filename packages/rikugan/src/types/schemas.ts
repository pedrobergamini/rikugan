import { z } from "zod";

const nullableOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional()) as z.ZodType<
    z.output<T> | undefined,
    z.ZodTypeDef,
    z.input<T> | null | undefined
  >;

export const groupSchema = z.object({
  id: z.string(),
  title: z.string(),
  rationale: z.string(),
  reviewFocus: nullableOptional(z.array(z.string())),
  risk: z.enum(["low", "medium", "high"]),
  hunkIds: z.array(z.string()),
  suggestedTests: nullableOptional(z.array(z.string()))
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
    hunkId: nullableOptional(z.string())
  }),
  actions: nullableOptional(
    z.array(
      z.object({
        label: z.string(),
        action: z.literal("openChat"),
        scope: z.enum(["group", "file", "repo"])
      })
    )
  )
});

export const annotationsSchema = z.object({
  annotations: z.array(annotationSchema)
});

export const findingSchema = z.object({
  id: z.string(),
  kind: z.enum(["bug", "flag"]),
  severity: nullableOptional(z.enum(["severe", "normal"])),
  flagClass: nullableOptional(z.enum(["investigate", "informational"])),
  confidence: z.number().min(0).max(1),
  title: z.string(),
  detailMarkdown: z.string(),
  evidence: z.array(
    z.object({
      filePath: z.string(),
      side: nullableOptional(z.enum(["old", "new"])),
      lineRange: nullableOptional(
        z.tuple([z.number().int().positive(), z.number().int().positive()])
      ),
      hunkId: nullableOptional(z.string()),
      excerpt: nullableOptional(z.string())
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
