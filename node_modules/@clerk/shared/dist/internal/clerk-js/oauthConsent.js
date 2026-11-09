Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

//#region src/internal/clerk-js/oauthConsent.ts
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
function getRedirectDisplay(url) {
	let hostname;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return "";
	}
	if (!hostname) return "";
	const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
	if (IPV4_REGEX.test(host)) return host;
	if (host.includes(":")) return `[${host}]`;
	return host.split(".").slice(-2).join(".");
}

//#endregion
exports.getRedirectDisplay = getRedirectDisplay;
//# sourceMappingURL=oauthConsent.js.map