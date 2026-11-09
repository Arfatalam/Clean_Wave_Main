
"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "cw_session";
const DEFAULT_SESSION_DAYS = 7;
const REMEMBER_SESSION_DAYS = 20;

function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie || "";
    const cookies = {};

    cookieHeader.split(";").forEach(part => {
        const index = part.indexOf("=");

        if (index === -1) return;

        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();

        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
    });

    return cookies;
}

function setSessionCookie(res, token, days = DEFAULT_SESSION_DAYS) {
    const validDays =
        Number(days) === REMEMBER_SESSION_DAYS
            ? REMEMBER_SESSION_DAYS
            : DEFAULT_SESSION_DAYS;

    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: validDays * 24 * 60 * 60 * 1000
    });
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/"
    });
}

async function requireSignedIn(req, res, next) {
    try {
        const token = parseCookies(req)[COOKIE_NAME];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Please log in to continue."
            });
        }

        const db = req.app.locals.supabase;

        if (!db) {
            throw new Error("Supabase client is not initialized.");
        }

        const tokenHash = hashToken(token);

        const { data: session, error: sessionError } = await db
            .from("app_sessions")
            .select("id,user_id,expires_at")
            .eq("token_hash", tokenHash)
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();

        if (sessionError) {
            throw sessionError;
        }

        if (!session) {
            clearSessionCookie(res);

            return res.status(401).json({
                success: false,
                message: "Your session has expired. Please log in again."
            });
        }

        const { data: user, error: userError } = await db
            .from("app_users")
            .select(
                "id,full_name,company_name,email,phone,role,is_active"
            )
            .eq("id", session.user_id)
            .maybeSingle();

        if (userError) {
            throw userError;
        }

        if (!user || !user.is_active) {
            clearSessionCookie(res);

            return res.status(401).json({
                success: false,
                message: "This account is unavailable."
            });
        }

        req.user = user;
        req.userId = user.id;
        req.sessionId = session.id;

        return next();

    } catch (error) {
        console.error("Authentication middleware error:", error);

        return res.status(500).json({
            success: false,
            message: "Authentication failed. Please try again."
        });
    }
}

async function requireAdmin(req, res, next) {
    return requireSignedIn(req, res, () => {
        if (!req.user || req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Admin access required."
            });
        }

        return next();
    });
}

module.exports = {
    COOKIE_NAME,
    DEFAULT_SESSION_DAYS,
    REMEMBER_SESSION_DAYS,
    hashToken,
    parseCookies,
    setSessionCookie,
    clearSessionCookie,
    requireSignedIn,
    requireAdmin
};
