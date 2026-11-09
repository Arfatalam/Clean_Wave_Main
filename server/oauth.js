"use strict";

const GoogleStrategy = require("passport-google-oauth20").Strategy;
const oauthStateStore = require("./oauth-state-store");

module.exports = function configureOAuth(passport) {
    passport.use(
        "google",
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL,

                // Keep OAuth state protection enabled.
                state: true,

                // Use the signed-cookie state store instead of
                // Passport's default Express-session store.
                store: oauthStateStore
            },
            (accessToken, refreshToken, profile, done) => {
                const email = profile.emails?.[0]?.value || "";

                done(null, {
                    provider: "google",
                    providerId: profile.id,
                    email: email.toLowerCase(),
                    name: profile.displayName || "CLEAN WAVE Customer",
                    emailVerified: profile._json?.email_verified === true
                });
            }
        )
    );
};
