import { describe, expect, it } from "vitest";

import {
  annotationsSchema,
  findingsSchema,
  groupsSchema,
  reviewSchema
} from "../src/types/schemas";

describe("schemas", () => {
  it("validates grouping schema", () => {
    const data = {
      groups: [
        {
          id: "g1",
          title: "Core change",
          rationale: "Adjusted core flow",
          risk: "medium",
          hunkIds: ["file:1,1:1,1"]
        }
      ]
    };
    expect(groupsSchema.parse(data)).toEqual(data);
  });

  it("validates annotation schema", () => {
    const data = {
      annotations: [
        {
          id: "a1",
          kind: "explain",
          confidence: 0.7,
          title: "Why this",
          bodyMarkdown: "Explains change",
          anchor: { filePath: "src/foo.ts", side: "new", line: 3 },
          actions: [{ label: "Ask", action: "openChat", scope: "group" }]
        }
      ]
    };
    expect(annotationsSchema.parse(data)).toEqual(data);
  });

  it("validates findings schema", () => {
    const data = {
      findings: [
        {
          id: "f1",
          kind: "bug",
          severity: "normal",
          confidence: 0.5,
          title: "Potential issue",
          detailMarkdown: "Investigate this",
          evidence: [{ filePath: "src/foo.ts", lineRange: [2, 3] }],
          status: "open"
        }
      ]
    };
    expect(findingsSchema.parse(data)).toEqual(data);
  });

  it("validates review schema", () => {
    const data = {
      findings: [
        {
          id: "f1",
          kind: "flag",
          confidence: 0.6,
          title: "Potential issue",
          detailMarkdown: "Investigate this",
          evidence: [{ filePath: "src/foo.ts", lineRange: [2, 3] }],
          status: "open"
        }
      ],
      contextNotes: [
        {
          id: "n1",
          title: "Context note",
          bodyMarkdown: "Explains intent and impact.",
          confidence: 0.6,
          groupId: "g1",
          hunkIds: ["file:1,1:1,1"]
        }
      ]
    };
    expect(reviewSchema.parse(data)).toEqual(data);
  });
});
