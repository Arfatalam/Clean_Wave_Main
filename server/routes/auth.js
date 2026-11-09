
"use strict";

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const router = express.Router();

const {
    hashToken,
    parseCookies,
    setSessionCookie,
    clearSessionCookie,
    requireSignedIn,
    COOKIE_NAME
} = require("../auth");

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
    return String(value || "").replace(/\s+/g, "").trim();
}

function isRememberMeEnabled(value) {
    return value === true || value === "true" || value === "1";
}

function publicUser(user) {
    return {
        id: user.id,
        fullName: user.full_name,
        companyName: user.company_name || "",
        email: user.email,
        phone: user.phone || "",
        role: user.role
    };
}

async function createSession(res, user, rememberMe = false) {
    const db = res.app.locals.supabase;

    const token = crypto.randomBytes(48).toString("hex");
    const tokenHash = hashToken(token);

    const sessionDays = rememberMe ? 20 : 7;

    const expiresAt = new Date(
        Date.now() + sessionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error } = await db
        .from("app_sessions")
        .insert({
            user_id: user.id,
            token_hash: tokenHash,
            expires_at: expiresAt
        });

    if (error) {
        throw error;
    }

    setSessionCookie(res, token, sessionDays);
}

// SIGNUP
router.post("/signup", async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const fullName = String(req.body?.fullName || "").trim();
        const companyName = String(req.body?.companyName || "").trim();
        const email = normalizeEmail(req.body?.email);
        const phone = normalizePhone(req.body?.phone);
        const password = String(req.body?.password || "");

        const rememberMe = isRememberMeEnabled(
            req.body?.rememberMe
        );

        if (fullName.length < 2) {
            return res.status(400).json({
                success: false,
                message: "Enter your full name."
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address."
            });
        }

        if (phone && !/^\+?[0-9]{10,15}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid phone number."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must contain at least 8 characters."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const { data: user, error } = await db
            .from("app_users")
            .insert({
                full_name: fullName,
                company_name: companyName || null,
                email,
                phone: phone || null,
                password_hash: passwordHash,
                role: "customer",
                is_active: true
            })
            .select(
                "id,full_name,company_name,email,phone,role,is_active"
            )
            .single();

        if (error) {
            if (error.code === "23505") {
                return res.status(409).json({
                    success: false,
                    message: "An account with this email or phone already exists."
                });
            }

            throw error;
        }

        await createSession(res, user, rememberMe);

        return res.status(201).json({
            success: true,
            message: "Account created successfully.",
            user: publicUser(user)
        });

    } catch (error) {
        console.error("Signup error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not create your account. Please try again."
        });
    }
});

// LOGIN WITH EMAIL OR PHONE
router.post("/login", async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const identifier = String(
            req.body?.identifier || ""
        ).trim();

        const password = String(req.body?.password || "");

        const rememberMe = isRememberMeEnabled(
            req.body?.rememberMe
        );

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Enter your email or phone number and password."
            });
        }

        const isEmail = identifier.includes("@");

        let query = db
            .from("app_users")
            .select(
                "id,full_name,company_name,email,phone,password_hash,role,is_active"
            );

        if (isEmail) {
            query = query.eq("email", normalizeEmail(identifier));
        } else {
            query = query.eq("phone", normalizePhone(identifier));
        }

        const { data: user, error } = await query.maybeSingle();

        if (error) {
            throw error;
        }

        if (!user || !user.is_active || !user.password_hash) {
            return res.status(401).json({
                success: false,
                message: "Invalid login details."
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: "Invalid login details."
            });
        }

        await createSession(res, user, rememberMe);

        return res.json({
            success: true,
            message: "Login successful.",
            user: publicUser(user)
        });

    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            success: false,
            message: "Login could not be completed."
        });
    }
});

// CURRENT USER
router.get("/me", requireSignedIn, (req, res) => {
    return res.json({
        success: true,
        user: publicUser(req.user),
        isAdmin: req.user.role === "admin"
    });
});

// LOGOUT
router.post("/logout", async (req, res) => {
    try {
        const db = req.app.locals.supabase;
        const token = parseCookies(req)[COOKIE_NAME];

        if (token) {
            const { error } = await db
                .from("app_sessions")
                .delete()
                .eq("token_hash", hashToken(token));

            if (error) {
                throw error;
            }
        }

        clearSessionCookie(res);

        return res.json({
            success: true,
            message: "You have been logged out."
        });

    } catch (error) {
        console.error("Logout error:", error);

        clearSessionCookie(res);

        return res.status(500).json({
            success: false,
            message: "Logout could not be completed."
        });
    }
});

module.exports = router;
