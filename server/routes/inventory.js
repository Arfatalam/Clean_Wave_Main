const express = require("express");
const router = express.Router();

const { requireAdmin } = require("../auth");

router.use(requireAdmin);

// VIEW INVENTORY
router.get("/", async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("products")
            .select(
                "id,name,category,sku,stock_quantity,low_stock_threshold,unit,is_active"
            )
            .order("name");

        if (error) throw error;

        res.json({
            success: true,
            inventory: data
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Could not load inventory."
        });
    }
});

// ADJUST STOCK
router.post("/adjust", async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const productId = Number(req.body.product_id);
        const quantity = Number(req.body.quantity);
        const direction = String(req.body.direction || "");
        const notes = String(req.body.notes || "").trim();

        if (
            !Number.isInteger(productId) ||
            productId <= 0 ||
            !Number.isFinite(quantity) ||
            quantity <= 0 ||
            !["add", "remove"].includes(direction)
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid product, quantity and direction."
            });
        }

        const { data: product, error: productError } = await db
            .from("products")
            .select("id,name,stock_quantity")
            .eq("id", productId)
            .single();

        if (productError) throw productError;

        const oldStock = Number(product.stock_quantity || 0);

        const signedQuantity =
            direction === "add" ? quantity : -quantity;

        const newStock = oldStock + signedQuantity;

        if (newStock < 0) {
            return res.status(400).json({
                success: false,
                message: "There is not enough stock for this adjustment."
            });
        }

        const { data: updatedProduct, error: updateError } = await db
            .from("products")
            .update({
                stock_quantity: newStock,
                updated_at: new Date().toISOString()
            })
            .eq("id", productId)
            .select()
            .single();

        if (updateError) throw updateError;

        const { error: transactionError } = await db
            .from("inventory_transactions")
            .insert({
                product_id: productId,
                transaction_type: "adjustment",
                quantity: signedQuantity,
                notes: notes || `Manual stock ${direction}`
            });

        if (transactionError) {
            // Try to restore the previous quantity if logging fails.
            await db.from("products")
                .update({ stock_quantity: oldStock })
                .eq("id", productId);

            throw transactionError;
        }

        res.json({
            success: true,
            message: "Stock updated successfully.",
            product: updatedProduct
        });

    } catch (error) {
        console.error(error);

        res.status(400).json({
            success: false,
            message: "Could not adjust stock."
        });
    }
});

// VIEW STOCK HISTORY
router.get("/history", async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("inventory_transactions")
            .select("*,products(name,category,unit)")
            .order("created_at", { ascending: false })
            .limit(500);

        if (error) throw error;

        res.json({
            success: true,
            transactions: data
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Could not load stock history."
        });
    }
});

module.exports = router;