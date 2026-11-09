const express = require("express");
const router = express.Router();

const { requireAdmin } = require("../auth");

router.use(requireAdmin);

router.get("/", async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("customers")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            customers: data
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Could not load customers."
        });
    }
});

module.exports = router;