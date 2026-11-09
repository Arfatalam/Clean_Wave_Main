"use strict";

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

const router = express.Router();
const { requireAdmin } = require("../auth");

const CATEGORIES = ["industrial", "household", "car-wash"];
const STORAGE_BUCKET = "product-images";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_IMAGE_SIZE,
        files: 1
    },
    fileFilter: (req, file, callback) => {
        if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
            return callback(
                new Error("Only JPG, PNG, WEBP and GIF images are allowed.")
            );
        }

        callback(null, true);
    }
});

// ==========================================
// PUBLIC: LOAD ACTIVE PRODUCTS
// Must be BEFORE router.use(requireAdmin)
// ==========================================

router.get("/public", async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("products")
            .select(`
                id,
                name,
                category,
                sku,
                description,
                selling_price,
                unit,
                image_url,
                stock_quantity,
                low_stock_threshold
            `)
            .eq("is_active", true)
            .order("id", { ascending: true });

        if (error) throw error;

        res.json({
            success: true,
            products: data || []
        });

    } catch (error) {
        console.error("Public products error:", error);

        res.status(500).json({
            success: false,
            message: "Could not load products."
        });
    }
});

// ==========================================
// ALL ROUTES BELOW THIS LINE REQUIRE ADMIN
// ==========================================

router.use(requireAdmin);

// ==========================================
// IMAGE UPLOAD TO SUPABASE STORAGE
// POST /api/products/upload-image
// ==========================================

router.post("/upload-image", (req, res) => {
    upload.single("image")(req, res, async error => {
        if (error) {
            console.error("Image upload validation error:", error);

            return res.status(400).json({
                success: false,
                message: error.code === "LIMIT_FILE_SIZE"
                    ? "Image size must not exceed 5 MB."
                    : error.message || "Invalid image file."
            });
        }

        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "Please select an image to upload."
                });
            }

            const extension = ALLOWED_IMAGE_TYPES[req.file.mimetype];

            if (!extension) {
                return res.status(400).json({
                    success: false,
                    message: "Unsupported image type."
                });
            }

            const supabase = req.app.locals.supabase;

            if (!supabase) {
                throw new Error("Supabase connection is not configured.");
            }

            const fileName = `${crypto.randomUUID()}${extension}`;
            const filePath = `products/${fileName}`;

            const { error: storageError } = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(filePath, req.file.buffer, {
                    contentType: req.file.mimetype,
                    cacheControl: "3600",
                    upsert: false
                });

            if (storageError) {
                console.error("Supabase Storage error:", storageError);
                throw new Error(
                    storageError.message || "Could not upload image to storage."
                );
            }

            const { data: publicData } = supabase.storage
                .from(STORAGE_BUCKET)
                .getPublicUrl(filePath);

            const imageUrl = publicData?.publicUrl;

            if (!imageUrl) {
                throw new Error("Could not generate the public image URL.");
            }

            return res.status(201).json({
                success: true,
                message: "Product image uploaded successfully.",
                image_url: imageUrl,
                path: filePath
            });

        } catch (uploadError) {
            console.error("Product image upload error:", uploadError);

            return res.status(500).json({
                success: false,
                message: uploadError.message || "Could not upload product image."
            });
        }
    });
});

// ==========================================
// PRODUCT VALIDATION
// ==========================================

function validateProduct(body) {
    if (!body || typeof body !== "object") {
        return "Invalid product information.";
    }

    if (!String(body.name || "").trim()) {
        return "Product name is required.";
    }

    if (!CATEGORIES.includes(body.category)) {
        return "Select a valid product category.";
    }

    const sellingPrice = Number(body.selling_price);
    const costPrice = Number(body.cost_price ?? 0);
    const stock = Number(body.stock_quantity ?? 0);
    const threshold = Number(body.low_stock_threshold ?? 5);

    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
        return "Enter a valid selling price.";
    }

    if (!Number.isFinite(costPrice) || costPrice < 0) {
        return "Enter a valid cost price.";
    }

    if (!Number.isFinite(stock) || stock < 0) {
        return "Enter a valid stock quantity.";
    }

    if (!Number.isFinite(threshold) || threshold < 0) {
        return "Enter a valid low-stock threshold.";
    }

    const imageUrl = String(body.image_url || "").trim();

    if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
        return "Image URL must start with http:// or https://.";
    }

    return null;
}

function makeProduct(body) {
    return {
        name: String(body.name).trim(),
        category: body.category,
        sku: String(body.sku || "").trim() || null,
        description: String(body.description || "").trim() || null,
        selling_price: Number(body.selling_price),
        cost_price: Number(body.cost_price ?? 0),
        unit: String(body.unit || "").trim() || null,
        image_url: String(body.image_url || "").trim() || null,
        stock_quantity: Number(body.stock_quantity ?? 0),
        low_stock_threshold: Number(body.low_stock_threshold ?? 5),
        is_active: body.is_active !== false
    };
}

// ==========================================
// ADMIN: GET ALL PRODUCTS
// ==========================================

router.get("/", async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("products")
            .select("*")
            .order("id", { ascending: true });

        if (error) throw error;

        res.json({
            success: true,
            products: data || []
        });

    } catch (error) {
        console.error("Load products error:", error);

        res.status(500).json({
            success: false,
            message: "Could not load products."
        });
    }
});

// ==========================================
// ADMIN: ADD PRODUCT
// ==========================================

router.post("/", async (req, res) => {
    try {
        const validationError = validateProduct(req.body);

        if (validationError) {
            return res.status(400).json({
                success: false,
                message: validationError
            });
        }

        const { data, error } = await req.app.locals.supabase
            .from("products")
            .insert(makeProduct(req.body))
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            message: "Product added successfully.",
            product: data
        });

    } catch (error) {
        console.error("Add product error:", error);

        res.status(400).json({
            success: false,
            message: error.code === "23505"
                ? "This SKU already exists."
                : "Could not add product."
        });
    }
});

// ==========================================
// ADMIN: UPDATE PRODUCT
// ==========================================

router.put("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid product ID."
            });
        }

        const validationError = validateProduct(req.body);

        if (validationError) {
            return res.status(400).json({
                success: false,
                message: validationError
            });
        }

        const update = {
            ...makeProduct(req.body),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await req.app.locals.supabase
            .from("products")
            .update(update)
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: "Product updated successfully.",
            product: data
        });

    } catch (error) {
        console.error("Update product error:", error);

        res.status(400).json({
            success: false,
            message: error.code === "23505"
                ? "This SKU already exists."
                : "Could not update product."
        });
    }
});

// ==========================================
// ADMIN: DEACTIVATE PRODUCT
// ==========================================

router.delete("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid product ID."
            });
        }

        const { data, error } = await req.app.locals.supabase
            .from("products")
            .update({
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: "Product deactivated successfully.",
            product: data
        });

    } catch (error) {
        console.error("Deactivate product error:", error);

        res.status(400).json({
            success: false,
            message: "Could not deactivate product."
        });
    }
});

module.exports = router;