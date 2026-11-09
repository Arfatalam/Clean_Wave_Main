
"use strict";

const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../auth");
const { getAllRows } = require("../reporting-utils");

router.use(requireAdmin);

router.get("/", async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const tables = [
            "orders",
            "order_items",
            "expenses",
            "customers",
            "products",
            "inventory_transactions"
        ];

        const backup = {
            application: "CLEAN WAVE",
            backup_type: "business_data",
            generated_at: new Date().toISOString(),
            timezone: "Asia/Kolkata",
            tables: {}
        };

        const recordCounts = {};

        for (const table of tables) {
            const rows = await getAllRows(db, table);

            backup.tables[table] = rows;
            recordCounts[table] = rows.length;
        }

        const filename =
            `clean-wave-backup-${new Date()
                .toISOString()
                .replace(/[:.]/g, "-")}.json`;

        // Record that the complete backup was generated.
        const { error: logError } = await db
            .from("reporting_backups")
            .insert({
                filename,
                record_counts: recordCounts
            });

        if (logError) throw logError;

        const json = JSON.stringify(backup, null, 2);

        res.setHeader(
            "Content-Type",
            "application/json; charset=utf-8"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`
        );

        res.setHeader("Cache-Control", "no-store");

        return res.send(json);

    } catch (error) {
        console.error("CLEAN WAVE backup error:", error);

        return res.status(500).json({
            success: false,
            message:
                error.message || "Could not create business backup."
        });
    }
});

module.exports = router;
