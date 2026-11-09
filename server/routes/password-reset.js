
"use strict";

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");

const { hashToken } = require("../auth");

const router = express.Router();

const RESET_EXPIRY_MINUTES = 30;

// ==========================================
// EMAIL NORMALIZATION
// ==========================================

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

// ==========================================
// GMAIL SMTP CONFIGURATION
// ==========================================

function createMailTransporter() {

    const gmailUser = process.env.GMAIL_USER;
    const gmailPassword = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailPassword) {
        throw new Error("Gmail SMTP configuration is missing.");
    }

    return nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,

        auth: {
            user: gmailUser,
            pass: gmailPassword
        }
    });
}

// ==========================================
// SEND PASSWORD RESET EMAIL
// ==========================================

async function sendResetEmail(email, name, resetUrl) {

    const transporter = createMailTransporter();

    const senderName =
        process.env.GMAIL_SENDER_NAME || "CLEAN WAVE";

    await transporter.sendMail({

        from: {
            name: senderName,
            address: process.env.GMAIL_USER
        },

        to: email,

        subject: "CLEAN WAVE - Reset Your Password",

        text: `
Hello ${name || "Customer"},

We received a request to reset your CLEAN WAVE account password.

Open this link to create a new password:

${resetUrl}

This link expires in 30 minutes and can only be used once.

If you did not request this change, you can ignore this email.

CLEAN WAVE
Palsana, Surat, Gujarat, India
        `,

        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CLEAN WAVE Password Reset</title>
</head>

<body style="margin:0;padding:25px;background:#f3f6fb;
             font-family:Arial,sans-serif;">

    <div style="max-width:560px;margin:30px auto;background:#fff;
                border-radius:12px;padding:35px 25px;">

        <h1 style="color:#0877d1;text-align:center;">
            CLEAN WAVE
        </h1>

        <h2 style="color:#172b4d;">
            Reset Your Password
        </h2>

        <p>Hello,</p>

        <p>
            We received a request to reset your CLEAN WAVE
            account password.
        </p>

        <p style="text-align:center;margin:30px 0;">
            <a href="${resetUrl}"
               style="background:#0877d1;color:#fff;
                      padding:14px 28px;text-decoration:none;
                      border-radius:7px;display:inline-block;
                      font-weight:bold;">
                Reset Password
            </a>
        </p>

        <p>
            This link expires in 30 minutes and can only
            be used once.
        </p>

        <p>
            If you did not request this change, you can
            safely ignore this email.
        </p>

        <hr style="border:none;border-top:1px solid #eee;">

        <p style="font-size:12px;color:#777;">
            CLEAN WAVE | Palsana, Surat, Gujarat, India
        </p>

    </div>

</body>
</html>
        `

    });

}

// ==========================================
// FORGOT PASSWORD
// POST /api/password/forgot
// ==========================================

router.post("/forgot", async (req, res) => {

    try {

        const email = normalizeEmail(req.body.email);

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address."
            });

        }

        const db = req.app.locals.supabase;

        const { data: user, error } = await db
            .from("app_users")
            .select("id,full_name,email,is_active")
            .eq("email", email)
            .maybeSingle();

        if (error) throw error;

        const genericMessage =
            "If an active account exists with this email, a password reset link will be sent.";

        // Do not reveal whether an account exists.
        if (!user || !user.is_active) {

            return res.json({
                success: true,
                message: genericMessage
            });

        }

        // Invalidate earlier unused links.
        const { error: invalidateError } = await db
            .from("password_reset_tokens")
            .update({
                used_at: new Date().toISOString()
            })
            .eq("user_id", user.id)
            .is("used_at", null);

        if (invalidateError) throw invalidateError;

        // Generate a secure random token.
        const rawToken = crypto
            .randomBytes(32)
            .toString("hex");

        // Store only the hash.
        const tokenHash = hashToken(rawToken);

        const expiresAt = new Date(
            Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000
        ).toISOString();

        const { error: insertError } = await db
            .from("password_reset_tokens")
            .insert({
                user_id: user.id,
                token_hash: tokenHash,
                expires_at: expiresAt
            });

        if (insertError) throw insertError;

        const baseUrl =
            (process.env.APP_BASE_URL || "").replace(/\/+$/, "");

        if (!baseUrl) {
            throw new Error("APP_BASE_URL is missing.");
        }

        const resetUrl =
            `${baseUrl}/reset-password.html?token=` +
            encodeURIComponent(rawToken);

        try {

            await sendResetEmail(
                user.email,
                user.full_name,
                resetUrl
            );

        } catch (emailError) {

            // Invalidate a token if sending its email fails.
            await db
                .from("password_reset_tokens")
                .update({
                    used_at: new Date().toISOString()
                })
                .eq("token_hash", tokenHash);

            throw emailError;
        }

        return res.json({
            success: true,
            message: genericMessage
        });

    } catch (error) {

        console.error("CLEAN WAVE forgot password error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to process your request. Please try again later."
        });

    }

});

// ==========================================
// RESET PASSWORD
// POST /api/password/reset
// ==========================================

router.post("/reset", async (req, res) => {

    try {

        const token = String(req.body.token || "").trim();
        const password = String(req.body.password || "");

        if (!token || token.length > 256) {

            return res.status(400).json({
                success: false,
                message: "Invalid or expired reset link."
            });

        }

        if (password.length < 8) {

            return res.status(400).json({
                success: false,
                message: "Password must contain at least 8 characters."
            });

        }

        if (Buffer.byteLength(password, "utf8") > 72) {

            return res.status(400).json({
                success: false,
                message: "Password must not exceed 72 UTF-8 bytes."
            });

        }

        const db = req.app.locals.supabase;

        const passwordHash = await bcrypt.hash(password, 12);

        const { data: resetSuccess, error } = await db.rpc(
            "consume_password_reset",
            {
                p_token_hash: hashToken(token),
                p_password_hash: passwordHash
            }
        );

        if (error) throw error;

        if (resetSuccess !== true) {

            return res.status(400).json({
                success: false,
                message: "This reset link is invalid, expired, or already used."
            });

        }

        return res.json({
            success: true,
            message: "Your password has been changed successfully. Please log in again."
        });

    } catch (error) {

        console.error("CLEAN WAVE reset password error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to reset your password. Please try again."
        });

    }

});

module.exports = router;
