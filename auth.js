
"use strict";

const AUTH_API = "/api/auth";

function showAuthMessage(message, type = "error") {
    const element = document.getElementById("authMessage");

    if (element) {
        element.textContent = message;
        element.className = `auth-message ${type}`;
        element.hidden = false;
    } else {
        alert(message);
    }
}

async function authRequest(endpoint, options = {}) {
    const response = await fetch(`${AUTH_API}${endpoint}`, {
        method: options.method || "GET",
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json"
        },
        ...(options.body
            ? { body: JSON.stringify(options.body) }
            : {})
    });

    if (response.status === 401 && endpoint === "/me") {
        return {
            success: false,
            unauthenticated: true,
            user: null
        };
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error("Invalid response from server.");
    }

    if (!response.ok || result.success === false) {
        throw new Error(result.message || "Request failed.");
    }

    return result;
}

function getRedirectTarget(user) {
    const next = new URLSearchParams(location.search).get("next");

    if (user?.role === "admin") {
        return "/admin.html";
    }

    if (next) {
        try {
            const url = new URL(next, location.origin);

            if (url.origin === location.origin) {
                return url.href;
            }
        } catch {
            // Use the default destination.
        }
    }

    return "/index.html";
}

const cleanWaveAuth = {
    signUp(data) {
        return authRequest("/signup", {
            method: "POST",
            body: data
        });
    },

    signIn(identifier, password, rememberMe = false) {
        return authRequest("/login", {
            method: "POST",
            body: {
                identifier,
                password,
                rememberMe
            }
        });
    },

    async getUser() {
        try {
            const result = await authRequest("/me");

            return {
                data: {
                    user: result.user || null
                },
                error: null
            };
        } catch (error) {
            return {
                data: {
                    user: null
                },
                error
            };
        }
    },

    signOut() {
        return authRequest("/logout", {
            method: "POST"
        });
    }
};

window.cleanWaveAuth = cleanWaveAuth;

window.cleanWaveAuthReady = Promise.resolve({
    auth: {
        getUser: cleanWaveAuth.getUser,
        signOut: cleanWaveAuth.signOut
    }
});

// LOGIN FORM
function setupLoginForm() {
    const form = document.getElementById("loginForm");

    if (!form) return;

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const identifier =
            document.getElementById("identifier")?.value.trim() ||
            document.getElementById("loginIdentifier")?.value.trim() ||
            document.getElementById("loginEmail")?.value.trim() ||
            "";

        const password =
            document.getElementById("password")?.value ||
            document.getElementById("loginPassword")?.value ||
            "";

        const rememberMe =
            document.getElementById("rememberMe")?.checked || false;

        const button = form.querySelector('[type="submit"]');

        if (!identifier || !password) {
            showAuthMessage("Enter your email/phone and password.");
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Logging in...";
        }

        try {
            const result = await cleanWaveAuth.signIn(
                identifier,
                password,
                rememberMe
            );

            showAuthMessage("Login successful. Redirecting...", "success");

            window.location.replace(getRedirectTarget(result.user));

        } catch (error) {
            showAuthMessage(error.message);

            if (button) {
                button.disabled = false;
                button.textContent = "Login";
            }
        }
    });
}

// SIGNUP FORM
function setupSignupForm() {
    const form = document.getElementById("signupForm");

    if (!form) return;

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const fullName =
            document.getElementById("fullName")?.value.trim() || "";

        const companyName =
            document.getElementById("companyName")?.value.trim() || "";

        const email =
            document.getElementById("signupEmail")?.value.trim() || "";

        const phone =
            document.getElementById("signupPhone")?.value.trim() || "";

        const password =
            document.getElementById("signupPassword")?.value || "";

        const confirmPassword =
            document.getElementById("confirmPassword")?.value || "";

        const rememberMe =
            document.getElementById("signupRememberMe")?.checked || false;

        const button = form.querySelector('[type="submit"]');

        if (fullName.length < 2) {
            showAuthMessage("Please enter your full name.");
            return;
        }

        if (!email) {
            showAuthMessage("Please enter your email address.");
            return;
        }

        if (password.length < 8) {
            showAuthMessage("Password must contain at least 8 characters.");
            return;
        }

        if (password !== confirmPassword) {
            showAuthMessage("Passwords do not match.");
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Creating account...";
        }

        try {
            const result = await cleanWaveAuth.signUp({
                fullName,
                companyName,
                email,
                phone,
                password,
                rememberMe
            });

            showAuthMessage(
                "Account created successfully. Redirecting...",
                "success"
            );

            window.location.replace(getRedirectTarget(result.user));

        } catch (error) {
            showAuthMessage(error.message);

            if (button) {
                button.disabled = false;
                button.textContent = "Create Account";
            }
        }
    });
}

// GOOGLE LOGIN
function setupGoogleLogin() {
    const googleLoginBtn =
        document.getElementById("googleLoginBtn");

    const googleSignupBtn =
        document.getElementById("googleSignupBtn");

    [googleLoginBtn, googleSignupBtn]
        .filter(Boolean)
        .forEach(button => {
            button.addEventListener("click", () => {
                const rememberCheckbox =
                    document.getElementById("rememberMe") ||
                    document.getElementById("signupRememberMe");

                const rememberMe =
                    rememberCheckbox?.checked ? "1" : "0";

                window.location.assign(
                    `/api/oauth/google?remember=${rememberMe}`
                );
            });
        });
}

// PASSWORD SHOW / HIDE
function setupPasswordToggle() {
    document.querySelectorAll("[data-toggle-password]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const inputId =
                    button.getAttribute("data-toggle-password");

                const input = document.getElementById(inputId);

                if (!input) return;

                const show = input.type === "password";

                input.type = show ? "text" : "password";
                button.textContent = show ? "Hide" : "Show";
            });
        });

    const loginToggle = document.getElementById("togglePassword");

    if (loginToggle) {
        loginToggle.addEventListener("click", () => {
            const input = document.getElementById("password");

            if (!input) return;

            const show = input.type === "password";

            input.type = show ? "text" : "password";
            loginToggle.textContent = show ? "Hide" : "Show";
        });
    }
}

// NAVBAR / LOGOUT
async function setupNavbarAuthentication() {
    const accountLink = document.getElementById("accountLink");
    const logoutButton = document.getElementById("logoutButton");

    try {
        const result = await cleanWaveAuth.getUser();
        const user = result.data.user;

        if (accountLink) {
            if (user?.role === "admin") {
                accountLink.textContent = "Admin Panel";
                accountLink.href = "/admin.html";
            } else if (user) {
                accountLink.textContent = user.fullName || "My Account";
                accountLink.href = "/account.html";
            } else {
                accountLink.textContent = "Login / Sign Up";
                accountLink.href = "/login.html";
            }
        }

        if (logoutButton) {
            logoutButton.hidden = !user;

            if (user && !logoutButton.dataset.authBound) {
                logoutButton.dataset.authBound = "true";

                logoutButton.addEventListener("click", async () => {
                    logoutButton.disabled = true;
                    logoutButton.textContent = "Logging out...";

                    try {
                        await cleanWaveAuth.signOut();
                        window.location.replace("/index.html");
                    } catch (error) {
                        alert(error.message);
                        logoutButton.disabled = false;
                        logoutButton.textContent = "Logout";
                    }
                });
            }
        }
    } catch (error) {
        console.error("Navbar authentication error:", error);
    }
}

// INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
    setupLoginForm();
    setupSignupForm();
    setupGoogleLogin();
    setupPasswordToggle();
    setupNavbarAuthentication();
});
