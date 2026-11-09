
"use strict";

// ==========================================
// MESSAGE HELPER
// ==========================================

function showResetMessage(message, type) {

    const box = document.getElementById("resetMessage");

    if (!box) return;

    box.textContent = message;
    box.className = `message ${type}`;

}

// ==========================================
// API REQUEST
// ==========================================

async function passwordRequest(endpoint, body) {

    const response = await fetch(
        `/api/password/${endpoint}`,
        {
            method: "POST",
            credentials: "same-origin",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(body)
        }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {

        throw new Error(
            data.message || "Something went wrong."
        );

    }

    return data;

}

// ==========================================
// FORGOT PASSWORD
// ==========================================

function setupForgotPassword() {

    const form =
        document.getElementById("forgotPasswordForm");

    if (!form) return;

    form.addEventListener("submit", async event => {

        event.preventDefault();

        const email =
            document.getElementById("resetEmail").value.trim();

        const button =
            document.getElementById("forgotSubmitBtn");

        try {

            button.disabled = true;
            button.textContent = "Sending...";

            const result = await passwordRequest(
                "forgot",
                { email }
            );

            showResetMessage(
                result.message,
                "success"
            );

            form.reset();

        } catch (error) {

            showResetMessage(
                error.message,
                "error"
            );

        } finally {

            button.disabled = false;
            button.textContent = "Send Reset Link";

        }

    });

}

// ==========================================
// RESET PASSWORD
// ==========================================

function setupResetPassword() {

    const form =
        document.getElementById("resetPasswordForm");

    if (!form) return;

    const token = new URLSearchParams(
        window.location.search
    ).get("token");

    const button =
        document.getElementById("resetSubmitBtn");

    if (!token) {

        button.disabled = true;

        showResetMessage(
            "Invalid reset link. Please request a new one.",
            "error"
        );

        return;

    }

    form.addEventListener("submit", async event => {

        event.preventDefault();

        const password =
            document.getElementById("newPassword").value;

        const confirmPassword =
            document.getElementById("confirmPassword").value;

        if (password.length < 8) {

            showResetMessage(
                "Password must contain at least 8 characters.",
                "error"
            );

            return;

        }

        if (password !== confirmPassword) {

            showResetMessage(
                "Passwords do not match.",
                "error"
            );

            return;

        }

        if (new TextEncoder().encode(password).length > 72) {

            showResetMessage(
                "Password must not exceed 72 UTF-8 bytes.",
                "error"
            );

            return;

        }

        try {

            button.disabled = true;
            button.textContent = "Updating...";

            const result = await passwordRequest(
                "reset",
                {
                    token,
                    password
                }
            );

            showResetMessage(
                result.message,
                "success"
            );

            form.reset();

            button.textContent = "Password Updated";

            // Remove the token from the address bar.
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname
            );

            const link = document.createElement("a");

            link.href = "/login.html";
            link.textContent = "Go to Login";
            link.className = "back-link";

            document.getElementById("resetMessage")
                .appendChild(link);

        } catch (error) {

            showResetMessage(
                error.message,
                "error"
            );

            button.disabled = false;
            button.textContent = "Update Password";

        }

    });

}

// ==========================================
// INITIALIZE
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    setupForgotPassword();
    setupResetPassword();

});
