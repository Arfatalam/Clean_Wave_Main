"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "cw_oauth_state";
const COOKIE_PATH = "/api/oauth";
const COOKIE_MAX_AGE_SECONDS = 600;

function getSecret() {
    const secret = process.env.OAUTH_STATE_SECRET;

    if (!secret) {
        throw new Error("OAUTH_STATE_SECRET is not configured.");
    }

    return secret;
}

function sign(value) {
    return crypto
        .createHmac("sha256", getSecret())
        .update(value)
        .digest("base64url");
}

function appendSetCookie(res, cookie) {
    const existing = res.getHeader("Set-Cookie");

    if (!existing) {
        res.setHeader("Set-Cookie", cookie);
    } else if (Array.isArray(existing)) {
        res.setHeader("Set-Cookie", [...existing, cookie]);
    } else {
        res.setHeader("Set-Cookie", [existing, cookie]);
    }
}

function cookieOptions() {
    const secure = process.env.NODE_ENV === "production";

    return [
        "Path=" + COOKIE_PATH,
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=" + COOKIE_MAX_AGE_SECONDS,
        ...(secure ? ["Secure"] : [])
    ].join("; ");
}

function clearCookie(res) {
    const secure = process.env.NODE_ENV === "production";

    const parts = [
        COOKIE_NAME + "=",
        "Path=" + COOKIE_PATH,
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
        "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    ];

    if (secure) {
        parts.push("Secure");
    }

    appendSetCookie(res, parts.join("; "));
}

function readCookie(req) {
    const header = req.headers.cookie || "";

    const cookies = header.split(";");

    for (const item of cookies) {
        const separator = item.indexOf("=");

        if (separator === -1) continue;

        const name = item.slice(0, separator).trim();
        const value = item.slice(separator + 1).trim();

        if (name === COOKIE_NAME) {
            try {
                return decodeURIComponent(value);
            } catch {
                return null;
            }
        }
    }

    return null;
}

function safeEqual(first, second) {
    if (
        typeof first !== "string" ||
        typeof second !== "string"
    ) {
        return false;
    }

    const firstBuffer = Buffer.from(first);
    const secondBuffer = Buffer.from(second);

    if (firstBuffer.length !== secondBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function createCookiePayload(state, rememberMe) {
    const payload = {
        state,
        rememberMe,
        expiresAt: Date.now() + COOKIE_MAX_AGE_SECONDS * 1000
    };

    const encoded = Buffer
        .from(JSON.stringify(payload))
        .toString("base64url");

    const signature = sign(encoded);

    return encoded + "." + signature;
}

function verifyCookieValue(value) {
    if (typeof value !== "string") return null;

    const parts = value.split(".");

    if (parts.length !== 2) return null;

    const encoded = parts[0];
    const suppliedSignature = parts[1];

    const expectedSignature = sign(encoded);

    if (!safeEqual(suppliedSignature, expectedSignature)) {
        return null;
    }

    try {
        const payload = JSON.parse(
            Buffer.from(encoded, "base64url").toString("utf8")
        );

        if (
            !payload ||
            typeof payload.state !== "string" ||
            typeof payload.expiresAt !== "number" ||
            payload.expiresAt <= Date.now()
        ) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

const oauthStateStore = {
    // Passport calls store(req, state, meta, callback).
    store(req, state, meta, callback) {
        try {
            const randomState = crypto
                .randomBytes(32)
                .toString("base64url");

            const rememberMe =
                req.query?.remember === "1";

            const cookieValue = createCookiePayload(
                randomState,
                rememberMe
            );

            appendSetCookie(
                req.res,
                COOKIE_NAME + "=" +
                encodeURIComponent(cookieValue) +
                "; " + cookieOptions()
            );

            callback(null, randomState);
        } catch (error) {
            callback(error);
        }
    },

    // Passport calls verify(req, providedState, callback).
    verify(req, providedState, callback) {
        try {
            const cookieValue = readCookie(req);

            // Always clear the temporary cookie after callback.
            clearCookie(req.res);

            const payload = verifyCookieValue(cookieValue);

            if (
                !payload ||
                !safeEqual(payload.state, providedState)
            ) {
                return callback(
                    null,
                    false,
                    {
                        message: "Unable to verify OAuth authorization state."
                    }
                );
            }

            // Make the Remember Me choice available to the OAuth route.
            req.cwOAuthRememberMe =
                payload.rememberMe === true;

            return callback(null, true);
        } catch (error) {
            return callback(error);
        }
    }
};

module.exports = oauthStateStore;
