"use strict";

// Returns true when the given string is a YouTube URL (youtube.com,
// its subdomains, or youtu.be). Used to decide whether the omnibox should
// open the Neko remote-browser view instead of the Scramjet iframe.
function isYouTubeUrl(str) {
	let u;
	try {
		u = new URL(str);
	} catch (err) {
		return false;
	}
	const host = u.hostname.toLowerCase();
	return (
		host === "youtube.com" ||
		host.endsWith(".youtube.com") ||
		host === "youtu.be"
	);
}

// Dual-mode: ESM export for node --test, global for the browser <script>.
export { isYouTubeUrl };
if (typeof window !== "undefined") {
	window.isYouTubeUrl = isYouTubeUrl;
}
