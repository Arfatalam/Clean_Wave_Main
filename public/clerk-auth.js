
/* ==========================================
   CLEAN WAVE - CLERK AUTHENTICATION
   Plain HTML / CSS / JavaScript
   Customer Login + Signup + Account + Admin Redirect
========================================== */

(function () {
    "use strict";

    const KEY = window.CLEAN_WAVE_CLERK_PUBLISHABLE_KEY;
    const DEFAULT_AFTER_AUTH = "index.html";

    // ==========================================
    // SAFE REDIRECT HANDLING
    // Supports both redirect_url and next
    // ==========================================

    function safeNextUrl() {
        const params = new URLSearchParams(window.location.search);

        // Clerk standard redirect parameter first.
        const requested =
            params.get("redirect_url") ||
            params.get("next");

        if (!requested) {
            return DEFAULT_AFTER_AUTH;
        }

        try {
            const destination = new URL(
                requested,
                window.location.origin
            );

            // Only allow same-origin redirects.
            if (destination.origin !== window.location.origin) {
                return DEFAULT_AFTER_AUTH;
            }

            // Prevent redirect loops to login/signup.
            const path = destination.pathname.toLowerCase();

            if (
                path.endsWith("/login.html") ||
                path.endsWith("/signup.html")
            ) {
                return DEFAULT_AFTER_AUTH;
            }

            return (
                destination.pathname +
                destination.search +
                destination.hash
            );

        } catch (error) {
            console.error("Invalid redirect URL:", error);
            return DEFAULT_AFTER_AUTH;
        }
    }

    // ==========================================
    // LOAD SCRIPT
    // ==========================================

    function loadScript(src, attributes = {}) {
        return new Promise((resolve, reject) => {

            const existingScript = Array.from(
                document.scripts
            ).find(script => script.src === src);

            if (existingScript) {
                if (existingScript.dataset.loaded === "true") {
                    resolve();
                    return;
                }

                existingScript.addEventListener("load", resolve, {
                    once: true
                });

                existingScript.addEventListener(
                    "error",
                    () => reject(
                        new Error("Could not load Clerk script.")
                    ),
                    { once: true }
                );

                return;
            }

            const script = document.createElement("script");

            script.src = src;
            script.async = true;
            script.crossOrigin = "anonymous";

            Object.entries(attributes).forEach(([name, value]) => {
                script.setAttribute(name, value);
            });

            script.onload = () => {
                script.dataset.loaded = "true";
                resolve();
            };

            script.onerror = () => {
                reject(
                    new Error(
                        "Could not load Clerk. Check your internet connection and Clerk domain settings."
                    )
                );
            };

            document.head.appendChild(script);
        });
    }

    // ==========================================
    // GET CLERK FRONTEND DOMAIN
    // ==========================================

    function getClerkFrontendDomain(publishableKey) {
        try {
            let encoded = publishableKey.split("_")[2];

            if (!encoded) {
                throw new Error("Invalid publishable key.");
            }

            encoded = encoded
                .replace(/-/g, "+")
                .replace(/_/g, "/");

            encoded += "=".repeat(
                (4 - encoded.length % 4) % 4
            );

            let decoded = atob(encoded);

            decoded = decoded.replace(/\$$/, "");

            if (!decoded || !decoded.includes(".")) {
                throw new Error("Invalid Clerk domain.");
            }

            return decoded;

        } catch (error) {
            throw new Error(
                "Your Clerk Publishable Key looks invalid. Copy the complete key from Clerk Dashboard > API Keys."
            );
        }
    }

    // ==========================================
    // INITIALIZE CLERK
    // ==========================================

    async function initializeClerk() {

        if (!KEY || KEY.includes("YOUR_CLERK")) {
            throw new Error(
                "Add your Clerk Publishable Key in clerk-config.js before using login or signup."
            );
        }

        const domain = getClerkFrontendDomain(KEY);
        const baseUrl = `https://${domain}`;

        await loadScript(
            `${baseUrl}/npm/@clerk/ui@1/dist/ui.browser.js`
        );

        await loadScript(
            `${baseUrl}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
            {
                "data-clerk-publishable-key": KEY
            }
        );

        if (!window.Clerk) {
            throw new Error("Clerk SDK did not initialize.");
        }

        const redirectDestination = safeNextUrl();

        await window.Clerk.load({
            ui: {
                ClerkUI: window.__internal_ClerkUICtor
            },

            signInUrl: "login.html",
            signUpUrl: "signup.html",

            signInFallbackRedirectUrl: redirectDestination,
            signUpFallbackRedirectUrl: redirectDestination
        });

        window.cleanWaveClerk = window.Clerk;

        return window.Clerk;
    }

    // Shared initialization promise.
    window.cleanWaveClerkReady = initializeClerk();

    // ==========================================
    // AUTH NAVIGATION
    // ==========================================

    function addAuthNavigation(clerk) {

        const nav = document.getElementById("navbar");

        if (!nav) return;

        document.getElementById("cleanWaveAuthNav")?.remove();
        document.getElementById("cleanWaveUserButton")?.remove();

        if (clerk.isSignedIn && clerk.user) {

            const holder = document.createElement("span");

            holder.id = "cleanWaveUserButton";
            holder.className = "clerk-user-button-holder";

            nav.appendChild(holder);

            clerk.mountUserButton(holder, {
                afterSignOutUrl: "index.html"
            });

        } else {

            const link = document.createElement("a");

            link.id = "cleanWaveAuthNav";
            link.href = "login.html";
            link.className = "auth-nav-link";
            link.textContent = "Login / Sign Up";

            nav.appendChild(link);
        }
    }

    // ==========================================
    // DISPLAY AUTH ERRORS
    // ==========================================

    function showAuthError(error) {

        const target = document.getElementById("clerkError");

        if (target) {
            target.textContent =
                error?.message ||
                "Authentication could not be loaded.";
        }

        console.error("CLEAN WAVE Clerk:", error);
    }

    // ==========================================
    // LOGIN / SIGNUP / ACCOUNT
    // ==========================================

    async function setupAuthPage(clerk) {

        const signInRoot =
            document.getElementById("clerkSignIn");

        const signUpRoot =
            document.getElementById("clerkSignUp");

        const redirectDestination = safeNextUrl();

        // LOGIN PAGE
        if (signInRoot) {

            if (clerk.isSignedIn) {
                window.location.replace(redirectDestination);
                return;
            }

            clerk.mountSignIn(signInRoot, {
                signUpUrl: "signup.html",

                fallbackRedirectUrl: redirectDestination,

                signUpFallbackRedirectUrl: "signup.html"
            });
        }

        // SIGNUP PAGE
        if (signUpRoot) {

            if (clerk.isSignedIn) {
                window.location.replace(redirectDestination);
                return;
            }

            clerk.mountSignUp(signUpRoot, {
                signInUrl: "login.html",

                fallbackRedirectUrl: redirectDestination,

                signInFallbackRedirectUrl: "login.html"
            });
        }

        // ACCOUNT PAGE
        const accountName =
            document.getElementById("accountName");

        const accountEmail =
            document.getElementById("accountEmail");

        const accountAvatar =
            document.getElementById("accountAvatar");

        const accountUserButton =
            document.getElementById("accountUserButton");

        if (accountName || accountEmail || accountAvatar) {

            if (!clerk.isSignedIn || !clerk.user) {

                const loginURL = new URL(
                    "login.html",
                    window.location.href
                );

                loginURL.searchParams.set(
                    "next",
                    "account.html"
                );

                window.location.replace(loginURL.href);

                return;
            }

            const user = clerk.user;

            if (accountName) {
                accountName.textContent =
                    user.fullName ||
                    user.firstName ||
                    "CLEAN WAVE customer";
            }

            if (accountEmail) {
                accountEmail.textContent =
                    user.primaryEmailAddress?.emailAddress || "";
            }

            if (accountAvatar) {
                accountAvatar.textContent = (
                    user.firstName ||
                    user.fullName ||
                    "CW"
                ).slice(0, 2).toUpperCase();
            }

            if (accountUserButton) {
                clerk.mountUserButton(accountUserButton, {
                    afterSignOutUrl: "index.html"
                });
            }
        }
    }

    // ==========================================
    // PAGE INITIALIZATION
    // ==========================================

    document.addEventListener("DOMContentLoaded", async () => {

        try {

            const clerk = await window.cleanWaveClerkReady;

            addAuthNavigation(clerk);

            await setupAuthPage(clerk);

            // Update navigation when authentication changes.
            if (typeof clerk.addListener === "function") {
                clerk.addListener(() => {
                    addAuthNavigation(clerk);
                });
            }

        } catch (error) {

            showAuthError(error);

        }
    });

})();
