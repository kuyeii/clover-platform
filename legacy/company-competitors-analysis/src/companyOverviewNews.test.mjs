import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("./App.css", import.meta.url), "utf8");
const backendSource = await readFile(new URL("../backend/server.py", import.meta.url), "utf8");

test("company overview renders every Dify news item instead of limiting to three", () => {
  assert.equal(appSource.includes("latelyItems.slice(0, 3)"), false);
});

test("company overview news list scrolls when many items are returned", () => {
  assert.match(cssSource, /\.overview-news ul\s*{[^}]*max-height:/s);
  assert.match(cssSource, /\.overview-news ul\s*{[^}]*overflow-y:\s*auto/s);
});

test("all scrollbars use a compact style with lighter idle and stronger hover states", () => {
  assert.match(cssSource, /--scrollbar-thumb-idle:\s*rgba\(78,\s*105,\s*154,\s*0\.16\);/);
  assert.match(cssSource, /\*\s*{[^}]*scrollbar-width:\s*thin/s);
  assert.match(cssSource, /\*\s*{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb-idle\) transparent/s);
  assert.match(cssSource, /\*:hover\s*{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb\) transparent/s);
  assert.match(cssSource, /\*::-webkit-scrollbar-thumb\s*{[^}]*background-color:\s*var\(--scrollbar-thumb-idle\)/s);
  assert.match(cssSource, /\*:hover::-webkit-scrollbar-thumb\s*{[^}]*background-color:\s*var\(--scrollbar-thumb\)/s);
});

test("sidebar hover promotes its nested history scrollbar to the active color", () => {
  assert.match(cssSource, /\.sidebar:hover \.history-list\s*{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb\) transparent/s);
  assert.match(
    cssSource,
    /\.sidebar:hover \.history-list::-webkit-scrollbar-thumb\s*{[^}]*background-color:\s*var\(--scrollbar-thumb\)/s
  );
});

test("history list keeps top breathing room so the first record is not clipped", () => {
  assert.match(cssSource, /\.history-list\s*{[^}]*padding:\s*4px 4px 2px 0;/s);
  assert.doesNotMatch(cssSource, /\.history-list\s*{[^}]*padding:\s*0 4px 0 0;/s);
});

test("history records keep vertical padding so their top edge is not clipped", () => {
  assert.match(cssSource, /\.history-entry\s*{[^}]*padding:\s*5px 8px 6px 24px;/s);
  assert.doesNotMatch(cssSource, /\.history-entry\s*{[^}]*padding:\s*0 8px 0 24px;/s);
});

test("competitor cards prefer completed summaries over pending placeholder intro", () => {
  assert.match(appSource, /const hasPendingIntro = isPendingCompetitorIntro\(item\.intro\);/);
  assert.match(
    appSource,
    /const summaryText = statusError \|\| \(!hasPendingIntro \? item\.intro : ""\) \|\| scoreSummary \|\| detailSummary \|\| item\.intro \|\| "暂无简介。";/
  );
  assert.match(backendSource, /current_competitors = hydrate_competitor_intros\(current_competitors, current_competitor_details, current_score_result\)/);
});

test("single competitor cards keep the same column width as five-card grids", () => {
  assert.equal(appSource.includes("competitor-grid--single"), false);
  assert.equal(cssSource.includes("competitor-grid--single"), false);
  assert.match(cssSource, /\.competitor-grid\s*{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);/s);
});
