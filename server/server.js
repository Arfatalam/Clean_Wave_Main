"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const configureOAuth = require("./oauth");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// REQUIRED ENVIRONMENT VARIABLES
// ==========================================

const requiredVariables = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OAUTH_STATE_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CALLBACK_URL"
];

const missingVariables = requiredVariables.filter(
    key => !process.env[key] ||
        process.env[key].startsWith("YOUR_")
);

if (missingVariables.length) {
    console.error(
        "Missing environment variables:",
        missingVariables.join(", ")
    );
    process.exit(1);
}

app.disable("x-powered-by");
app.set("trust proxy", 1);


// ==========================================
// SECURITY MIDDLEWARE
// ==========================================

app.use("/api/backup", require("./routes/backup"));
app.use("/api/reports", require("./routes/reports"));

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json({ limit: "1mb" }));

app.use(express.urlencoded({
    extended: true,
    limit: "1mb"
}));

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false
}));

// ==========================================
// SUPABASE CONNECTION
// ==========================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

app.locals.supabase = supabase;

// ==========================================
// TEMPORARY GOOGLE OAUTH STATE SESSION
// ==========================================

app.use(session({
    name: "cw_oauth_state",
    secret: process.env.OAUTH_STATE_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 15 * 60 * 1000
    }
}));

app.use(passport.initialize());

configureOAuth(passport);

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "CLEAN WAVE backend is running.",
        time: new Date().toISOString()
    });
});

// ==========================================
// AUTH ROUTES
// ==========================================

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many authentication attempts. Please try again later."
    }
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth", require("./routes/auth"));

// ==========================================
// FORGOT PASSWORD / RESET PASSWORD
// ==========================================

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many password reset attempts. Please try again later."
    }
});

app.use(
    "/api/password",
    passwordResetLimiter,
    require("./routes/password-reset")
);

// ==========================================
// GOOGLE OAUTH ROUTES
// ==========================================

const oauthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,

    // More requests allowed during local development.
    limit: process.env.NODE_ENV === "production" ? 30 : 100,

    standardHeaders: "draft-7",
    legacyHeaders: false,

    message: {
        success: false,
        message: "Too many Google login attempts. Please wait 15 minutes."
    }
});

app.use("/api/oauth", oauthLimiter, require("./routes/oauth"));

// ==========================================
// BUSINESS ROUTES
// ==========================================

app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/products", require("./routes/products"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/expenses", require("./routes/expenses"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/inventory", require("./routes/inventory"));

// ==========================================
// STATIC WEBSITE
// ==========================================

const websiteFolder = path.join(__dirname, "..", "public");

app.use(express.static(websiteFolder, {
    dotfiles: "ignore",
    index: "index.html"
}));

// ==========================================
// UNKNOWN API
// ==========================================

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found."
    });
});

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((error, req, res, next) => {
    console.error("Backend error:", error);

    res.status(error.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === "development"
            ? error.message
            : "An unexpected server error occurred."
    });
});

// ==========================================
// START SERVER
// ==========================================

if (require.main === module) {
    app.listen(PORT, () => {
        console.log("------------------------------------");
        console.log("CLEAN WAVE backend started");
        console.log(`Website: http://localhost:${PORT}`);
        console.log(`Health: http://localhost:${PORT}/api/health`);
        console.log(`Admin: http://localhost:${PORT}/admin.html`);
        console.log("------------------------------------");
    });
}

module.exports = app;
