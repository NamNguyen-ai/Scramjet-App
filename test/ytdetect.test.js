"use strict";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isYouTubeUrl } from "../public/ytdetect.js";

test("matches youtube hosts", () => {
	assert.equal(isYouTubeUrl("https://youtube.com"), true);
	assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=abc"), true);
	assert.equal(isYouTubeUrl("https://m.youtube.com/"), true);
	assert.equal(isYouTubeUrl("https://music.youtube.com/"), true);
	assert.equal(isYouTubeUrl("https://youtu.be/abc"), true);
});

test("rejects non-youtube and lookalike hosts", () => {
	assert.equal(isYouTubeUrl("https://example.com"), false);
	assert.equal(isYouTubeUrl("https://notyoutube.com"), false);
	assert.equal(isYouTubeUrl("https://youtube.com.evil.com"), false);
	assert.equal(isYouTubeUrl("not a url"), false);
	assert.equal(isYouTubeUrl(""), false);
});
