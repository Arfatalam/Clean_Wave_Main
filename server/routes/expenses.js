const express = require("express");
const router = express.Router();

const { requireAdmin } = require("../auth");

router.use(requireAdmin);

const categories = [
    "raw_material",
    "packaging",
    "labour",
    "transport",
    "electricity",
    "rent",
    "maintenance",
    "marketing",
    "other"
];

// GET EXPENSES
router.get("/", async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("expenses")
            .select("*")
            .order("expense_date", { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            expenses: data
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Could not load expenses."
        });
    }
});

// ADD EXPENSE
router.post("/", async (req, res) => {
    try {
        const amount = Number(req.body.amount);
        const category = String(req.body.category || "");
        const title = String(req.body.title || "").trim();

        if (!title || title.length > 200) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid expense title."
            });
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid expense amount."
            });
        }

        if (!categories.includes(category)) {
            return res.status(400).json({
                success: false,
                message: "Select a valid expense category."
            });
        }

        const expenseDate = req.body.expense_date || undefined;

        if (
            expenseDate &&
            !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid expense date."
            });
        }

        const expense = {
            title,
            category,
            amount,
            expense_date: expenseDate,
            payment_method: req.body.payment_method || null,
            reference_number: req.body.reference_number || null,
            notes: req.body.notes || null
        };

        const { data, error } = await req.app.locals.supabase
            .from("expenses")
            .insert(expense)
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: "Expense recorded successfully.",
            expense: data
        });

    } catch (error) {
        console.error(error);

        res.status(400).json({
            success: false,
            message: "Could not save expense."
        });
    }
});

// UPDATE EXPENSE
router.put("/:id", async (req, res) => {
    try {
        const amount = Number(req.body.amount);
        const category = String(req.body.category || "");
        const title = String(req.body.title || "").trim();

        if (
            !title ||
            title.length > 200 ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            !categories.includes(category)
        ) {
            return res.status(400).json({
                success: false,
                message: "Check the expense details."
            });
        }

        const update = {
            title,
            category,
            amount,
            payment_method: req.body.payment_method || null,
            reference_number: req.body.reference_number || null,
            notes: req.body.notes || null
        };

        if (req.body.expense_date) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.expense_date)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid expense date."
                });
            }

            update.expense_date = req.body.expense_date;
        }

        const { data, error } = await req.app.locals.supabase
            .from("expenses")
            .update(update)
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: "Expense updated.",
            expense: data
        });

    } catch (error) {
        console.error(error);

        res.status(400).json({
            success: false,
            message: "Could not update expense."
        });
    }
});

// DELETE EXPENSE
router.delete("/:id", async (req, res) => {
    try {
        const { error } = await req.app.locals.supabase
            .from("expenses")
            .delete()
            .eq("id", req.params.id);

        if (error) throw error;

        res.json({
            success: true,
            message: "Expense deleted."
        });

    } catch (error) {
        console.error(error);

        res.status(400).json({
            success: false,
            message: "Could not delete expense."
        });
    }
});

module.exports = router;