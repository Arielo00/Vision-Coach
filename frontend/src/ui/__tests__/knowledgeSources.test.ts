import assert from "node:assert/strict";
import { test } from "node:test";

import { knowledgeSourceHref, knowledgeSourceLocation } from "../knowledgeSources.ts";
import { retrievalState } from "../presentationAdapters.ts";
import type { KnowledgeSourceReference } from "../../types";

test("las citas conservan páginas PDF y tiempos de video sin inventar páginas", () => {
  assert.equal(knowledgeSourceLocation({ filename: "manual.pdf", page: 17 }), "pág. 17");
  assert.equal(knowledgeSourceLocation({ filename: "video.mp4", page: null, source_type: "video", start_seconds: 12.5, end_seconds: 84 }), "0:12–1:24");
  assert.equal(knowledgeSourceLocation({ filename: "video.mp4", page: null, source_type: "video", start_seconds: NaN }), "Video completo");
});

test("los enlaces abren un momento del video completo y rechazan rutas ajenas", () => {
  const source: KnowledgeSourceReference = { filename: "video.mp4", page: null, source_type: "video", start_seconds: 12.5,
    video_url: "/api/library/coaching/example/videos/AbCdEfGhI_1" };
  assert.equal(knowledgeSourceHref(source, "http://localhost:8000"), "http://localhost:8000/api/library/coaching/example/videos/AbCdEfGhI_1#t=12");
  assert.equal(knowledgeSourceHref({ ...source, video_url: "/api/library/coaching/../../private", source_url: "javascript:alert(1)" }, "http://localhost:8000"), null);
  assert.equal(knowledgeSourceHref({ ...source, video_url: null, source_url: "https://www.youtube.com/watch?v=AbCdEfGhI_1" }, ""), "https://www.youtube.com/watch?v=AbCdEfGhI_1&t=12s");
});

test("la recuperación combinada no se presenta como completamente vectorial", () => {
  const state = retrievalState({ available: true, retrieval_mode: "mixed", fallback: true });
  assert.equal(state.kind, "mixto");
  assert.equal(state.label, "RECUPERACIÓN COMBINADA");
});
