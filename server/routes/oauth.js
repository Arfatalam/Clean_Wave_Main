"use strict";

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const passport = require("passport");

const router = express.Router();

const {
    hashToken,
    setSessionCookie
} = require("../auth");

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function startGoogleOAuth(req, res, next) {
    console.log("GOOGLE OAUTH ROUTE REACHED");
    console.log("Session available:", !!req.session);
    console.log("Google Client ID available:", !!process.env.GOOGLE_CLIENT_ID);
    console.log("Google Callback URL:", process.env.GOOGLE_CALLBACK_URL);

    if (!req.session) {
        return res.status(500).send("OAuth session is unavailable.");
    }

    req.session.cwRememberMe =
        req.query.remember === "1";

    req.session.save(error => {
        if (error) {
            console.error("OAuth session save error:", error);
            return next(error);
        }

        console.log("OAuth session saved. Redirecting to Google...");

        passport.authenticate("google", {
            scope: ["profile", "email"],
            session: false
        })(req, res, next);
    });
}

async function finishGoogleOAuth(req, res) {
    try {
        const profile = req.user;

        if (
            !profile ||
            !profile.providerId ||
            !profile.email
        ) {
            return res.redirect(
                "/login.html?oauth_error=email_required"
            );
        }

        if (profile.emailVerified !== true) {
            return res.redirect(
                "/login.html?oauth_error=email_unverified"
            );
        }

        const db = req.app.locals.supabase;
        const email = normalizeEmail(profile.email);

        // Check whether this Google identity is already linked.
        const { data: existingLink, error: linkError } = await db
            .from("oauth_accounts")
            .select("user_id")
            .eq("provider", "google")
            .eq("provider_user_id", profile.providerId)
            .maybeSingle();

        if (linkError) throw linkError;

        let user = null;

        if (existingLink) {
            const { data, error } = await db
                .from("app_users")
                .select("id,full_name,company_name,email,phone,role,is_active")
                .eq("id", existingLink.user_id)
                .maybeSingle();

            if (error) throw error;

            user = data;

        } else {
            // Do not silently link to an existing password account.
            const { data: existingUser, error: userError } = await db
                .from("app_users")
                .select("id,email")
                .eq("email", email)
                .maybeSingle();

            if (userError) throw userError;

            if (existingUser) {
                return res.redirect(
                    "/login.html?oauth_error=account_exists"
                );
            }

            // Create a new customer account.
            const randomPassword = crypto
                .randomBytes(48)
                .toString("hex");

            const passwordHash = await bcrypt.hash(
                randomPassword,
                12
            );

            const { data: newUser, error: createError } = await db
                .from("app_users")
                .insert({
                    full_name: profile.name,
                    company_name: null,
                    email,
                    phone: null,
                    password_hash: passwordHash,
                    role: "customer",
                    is_active: true
                })
                .select("id,full_name,company_name,email,phone,role,is_active")
                .single();

            if (createError) throw createError;

            user = newUser;

            const { error: insertLinkError } = await db
                .from("oauth_accounts")
                .insert({
                    user_id: user.id,
                    provider: "google",
                    provider_user_id: profile.providerId,
                    email
                });

            if (insertLinkError) throw insertLinkError;
        }

        if (!user || !user.is_active) {
            return res.redirect(
                "/login.html?oauth_error=account_unavailable"
            );
        }

        // Create CLEAN WAVE's own database-backed session.
        const token = crypto.randomBytes(48).toString("hex");
        const tokenHash = hashToken(token);

        const rememberMe =
            req.session?.cwRememberMe === true;

        const sessionDays = rememberMe ? 20 : 7;

        const expiresAt = new Date(
            Date.now() + sessionDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const { error: sessionError } = await db
            .from("app_sessions")
            .insert({
                user_id: user.id,
                token_hash: tokenHash,
                expires_at: expiresAt
            });

        if (sessionError) throw sessionError;

        setSessionCookie(res, token, sessionDays);

        req.session.destroy(() => {
            if (user.role === "admin") {
                return res.redirect("/admin.html");
            }

            return res.redirect("/index.html");
        });

    } catch (error) {
        console.error("CLEAN WAVE Google OAuth error:", error);

        return res.redirect(
            "/login.html?oauth_error=failed"
        );
    }
}

// GOOGLE LOGIN / SIGNUP
router.get("/google", startGoogleOAuth);

router.get(
    "/google/callback",
    passport.authenticate("google", {
        session: false,
        failureRedirect: "/login.html?oauth_error=google_failed"
    }),
    finishGoogleOAuth
);

module.exports = router;