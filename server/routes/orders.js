
"use strict";

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Razorpay = require("razorpay");

const { requireAdmin, requireSignedIn } = require("../auth");

const PAYMENT_PROVIDER = "razorpay";

function money(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function paise(value) {
    return Math.round(money(value) * 100);
}

function getRazorpay() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (
        !keyId ||
        !keySecret ||
        keyId.startsWith("YOUR_") ||
        keySecret.startsWith("YOUR_")
    ) {
        const error = new Error("Razorpay is not configured on the server.");
        error.status = 503;
        throw error;
    }

    return {
        client: new Razorpay({
            key_id: keyId,
            key_secret: keySecret
        }),
        keyId
    };
}

function safeSignatureCompare(received, expected) {
    if (
        typeof received !== "string" ||
        typeof expected !== "string" ||
        !/^[a-f0-9]{64}$/i.test(received) ||
        !/^[a-f0-9]{64}$/i.test(expected)
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(received, "hex"),
        Buffer.from(expected, "hex")
    );
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
    const secret = process.env.RAZORPAY_KEY_SECRET;

    if (!secret || !orderId || !paymentId || !signature) {
        return false;
    }

    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

    return safeSignatureCompare(signature, expected);
}

function paymentResponse(order, message) {
    const total = money(order.total_amount);
    const paid = money(order.paid_amount || 0);

    return {
        id: order.id,
        invoiceNumber: order.invoice_number,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentProvider: order.payment_provider,
        paymentStatus: order.payment_status,
        paymentReference: order.payment_reference,
        gatewayOrderId: order.gateway_order_id,
        gatewayPaymentId: order.gateway_payment_id,
        gatewayPaymentStatus: order.gateway_payment_status,
        gatewayQrId: order.gateway_qr_id || null,
        gatewayQrImageUrl: order.gateway_qr_image_url || null,
        gatewayQrStatus: order.gateway_qr_status || null,
        gatewayQrCloseBy: order.gateway_qr_close_by || null,
        paidAmount: paid,
        dueAmount: Math.max(0, money(total - paid)),
        total,
        message: message || null
    };
}

// ==========================================
// CUSTOMER ORDER LOOKUP
// ==========================================

async function getCustomerOrder(db, orderId, userId) {
    const { data, error } = await db
        .from("orders")
        .select("*,order_items(*)")
        .eq("id", orderId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;

    return data || null;
}

// ==========================================
// VERIFY AND SAVE CAPTURED QR PAYMENT
// ==========================================

async function markCapturedQrPayment(db, order, payment) {
    const expectedAmount = paise(order.total_amount);

    if (
        Number(payment.amount) !== expectedAmount ||
        String(payment.currency).toUpperCase() !== "INR" ||
        payment.status !== "captured" ||
        payment.captured !== true
    ) {
        throw new Error("QR payment does not match the CLEAN WAVE order.");
    }

    if (
        order.payment_status === "paid" &&
        order.gateway_payment_id &&
        order.gateway_payment_id !== payment.id
    ) {
        throw new Error("This order has already been paid.");
    }

    const { data, error } = await db
        .from("orders")
        .update({
            payment_method: "razorpay",
            payment_provider: PAYMENT_PROVIDER,
            gateway_payment_id: payment.id,
            gateway_payment_status: "captured",
            gateway_signature_verified: false,
            gateway_qr_status: "closed",
            payment_status: "paid",
            paid_amount: money(order.total_amount),
            payment_verified_at: new Date().toISOString(),
            payment_verified_by: "razorpay_qr_api"
        })
        .eq("id", order.id)
        .eq("user_id", order.user_id)
        .select()
        .single();

    if (error) throw error;

    return data;
}

// ==========================================
// VERIFY AND SAVE CAPTURED CHECKOUT PAYMENT
// ==========================================

async function markCapturedPayment(db, order, payment, userId) {
    const expectedAmount = paise(order.total_amount);

    if (
        Number(payment.amount) !== expectedAmount ||
        String(payment.currency).toUpperCase() !== "INR" ||
        payment.status !== "captured" ||
        payment.captured !== true ||
        String(payment.order_id) !== String(order.gateway_order_id)
    ) {
        throw new Error("Razorpay payment does not match the CLEAN WAVE order.");
    }

    if (
        order.payment_status === "paid" &&
        order.gateway_payment_id &&
        order.gateway_payment_id !== payment.id
    ) {
        throw new Error("This order has already been paid.");
    }

    const { data, error } = await db
        .from("orders")
        .update({
            payment_method: "razorpay",
            payment_provider: PAYMENT_PROVIDER,
            gateway_payment_id: payment.id,
            gateway_payment_status: "captured",
            gateway_signature_verified: true,
            payment_status: "paid",
            paid_amount: money(order.total_amount),
            payment_verified_at: new Date().toISOString(),
            payment_verified_by: userId
        })
        .eq("id", order.id)
        .eq("user_id", userId)
        .select()
        .single();

    if (error) throw error;

    return { order: data };
}

// ==========================================
// CUSTOMER: CREATE ORDER
// ==========================================

router.post("/", requireSignedIn, async (req, res) => {
    let createdOrderId = null;

    try {
        const db = req.app.locals.supabase;
        const userId = req.userId;
        const user = req.user;

        const itemsInput = req.body.items;

        if (
            !Array.isArray(itemsInput) ||
            itemsInput.length === 0 ||
            itemsInput.length > 100
        ) {
            return res.status(400).json({
                success: false,
                message: "Your order must contain valid products."
            });
        }

        const customerName = String(
            user.full_name || "CLEAN WAVE Customer"
        ).trim();

        const customerCompany = user.company_name
            ? String(user.company_name).trim()
            : null;

        const customerEmail = user.email
            ? String(user.email).trim().toLowerCase()
            : null;

        const customerPhone = String(
            req.body.customerPhone || user.phone || ""
        ).trim().slice(0, 40);

        const quantities = new Map();

        for (const item of itemsInput) {
            const productId = Number(item.productId);
            const quantity = Number(item.quantity);

            if (
                !Number.isInteger(productId) ||
                productId <= 0 ||
                !Number.isInteger(quantity) ||
                quantity <= 0 ||
                quantity > 100000
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid product or quantity."
                });
            }

            const newQuantity =
                (quantities.get(productId) || 0) + quantity;

            if (newQuantity > 100000) {
                return res.status(400).json({
                    success: false,
                    message: "Product quantity is too large."
                });
            }

            quantities.set(productId, newQuantity);
        }

        const productIds = [...quantities.keys()];

        const { data: products, error: productError } = await db
            .from("products")
            .select("id,name,unit,selling_price,is_active")
            .in("id", productIds)
            .eq("is_active", true);

        if (productError) throw productError;

        if (!products || products.length !== productIds.length) {
            return res.status(400).json({
                success: false,
                message: "One or more products are unavailable."
            });
        }

        const items = products.map(product => {
            const quantity = quantities.get(product.id);
            const price = money(product.selling_price);

            if (!Number.isFinite(price) || price <= 0) {
                throw new Error("A product has an invalid selling price.");
            }

            return {
                product_id: product.id,
                product_name: product.name,
                unit: product.unit || "Unit",
                quantity,
                selling_price: price,
                line_total: money(price * quantity)
            };
        });

        const subtotal = money(
            items.reduce((sum, item) => sum + item.line_total, 0)
        );

        if (!Number.isFinite(subtotal) || subtotal <= 0) {
            return res.status(400).json({
                success: false,
                message: "The order total is invalid."
            });
        }

        const date = new Date();

        const datePart = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("");

        const randomPart = crypto.randomBytes(4)
            .toString("hex")
            .slice(0, 6)
            .toUpperCase();

        const invoiceNumber = `CW-${datePart}-${randomPart}`;

        // Save/update customer details.
        const customerData = {
            user_id: userId,
            name: customerName,
            company_name: customerCompany,
            email: customerEmail,
            phone: customerPhone || null
        };

        const { error: customerError } = await db
            .from("customers")
            .upsert(customerData, {
                onConflict: "user_id"
            });

        if (customerError) throw customerError;

        // Save order.
        const { data: order, error: orderError } = await db
            .from("orders")
            .insert({
                invoice_number: invoiceNumber,
                user_id: userId,
                customer_name: customerName,
                company_name: customerCompany,
                customer_email: customerEmail,
                customer_phone: customerPhone || null,
                status: "pending",
                subtotal,
                total_amount: subtotal,
                whatsapp_sent: false,
                payment_method: "razorpay",
                payment_provider: PAYMENT_PROVIDER,
                payment_status: "pending",
                payment_reference: null,
                paid_amount: 0,
                gateway_order_id: null,
                gateway_payment_id: null,
                gateway_payment_status: null,
                gateway_signature_verified: false
            })
            .select()
            .single();

        if (orderError) throw orderError;

        createdOrderId = order.id;

        const orderItems = items.map(item => ({
            ...item,
            order_id: order.id
        }));

        const { error: itemsError } = await db
            .from("order_items")
            .insert(orderItems);

        if (itemsError) throw itemsError;

        return res.status(201).json({
            success: true,
            message: "Your order has been saved. Continue to Razorpay checkout.",
            order: {
                id: order.id,
                invoiceNumber: order.invoice_number,
                status: order.status,
                paymentStatus: order.payment_status,
                paymentMethod: order.payment_method,
                paymentReference: null,
                paidAmount: 0,
                dueAmount: subtotal,
                subtotal,
                total: subtotal,
                items
            }
        });

   } catch (error) {
    console.error("========== CLEAN WAVE ORDER ERROR ==========");
    console.error("Message:", error.message);
    console.error("Code:", error.code);
    console.error("Details:", error.details);
    console.error("Hint:", error.hint);
    console.error("Status:", error.status);
    console.error("============================================");

    // Clean up a partially created order.
    if (createdOrderId) {
        const db = req.app.locals.supabase;

        try {
            const { error: deleteItemsError } = await db
                .from("order_items")
                .delete()
                .eq("order_id", createdOrderId);

            if (deleteItemsError) {
                console.error("Order item cleanup error:", deleteItemsError);
            }

            const { error: deleteOrderError } = await db
                .from("orders")
                .delete()
                .eq("id", createdOrderId)
                .eq("user_id", req.userId);

            if (deleteOrderError) {
                console.error("Order cleanup error:", deleteOrderError);
            }
        } catch (cleanupError) {
            console.error("Order cleanup exception:", cleanupError);
        }
    }

    const isDevelopment = process.env.NODE_ENV !== "production";

    return res.status(error.status || 500).json({
        success: false,
        message: error.message || "Could not save your order.",
        ...(isDevelopment && {
            debug: {
                code: error.code || null,
                details: error.details || null,
                hint: error.hint || null
            }
        })
    });
}
});

// ==========================================
// CUSTOMER: CREATE RAZORPAY ORDER
// ==========================================

router.post("/:id/payment/create", requireSignedIn, async (req, res) => {
    try {
        const db = req.app.locals.supabase;
        const order = await getCustomerOrder(
            db,
            req.params.id,
            req.userId
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (order.status === "cancelled") {
            return res.status(400).json({
                success: false,
                message: "This order has been cancelled."
            });
        }

        if (order.payment_status === "paid") {
            return res.status(400).json({
                success: false,
                message: "This order is already paid."
            });
        }

        const { client, keyId } = getRazorpay();

        let gatewayOrder;

        if (order.gateway_order_id) {
            gatewayOrder = await client.orders.fetch(
                order.gateway_order_id
            );

            if (
                Number(gatewayOrder.amount) !== paise(order.total_amount) ||
                String(gatewayOrder.currency).toUpperCase() !== "INR"
            ) {
                throw new Error(
                    "Existing Razorpay order amount does not match."
                );
            }
        } else {
            gatewayOrder = await client.orders.create({
                amount: paise(order.total_amount),
                currency: "INR",
                receipt: String(order.invoice_number).slice(0, 40),
                notes: {
                    clean_wave_order_id: String(order.id),
                    invoice_number: String(order.invoice_number),
                    customer_user_id: String(req.userId)
                }
            });

            const { error } = await db
                .from("orders")
                .update({
                    payment_method: "razorpay",
                    payment_provider: PAYMENT_PROVIDER,
                    gateway_order_id: gatewayOrder.id,
                    gateway_payment_status: "created"
                })
                .eq("id", order.id)
                .eq("user_id", req.userId);

            if (error) throw error;
        }

        return res.json({
            success: true,
            keyId,
            razorpayOrderId: gatewayOrder.id,
            amount: gatewayOrder.amount,
            currency: gatewayOrder.currency,
            name: "CLEAN WAVE",
            description: `Order ${order.invoice_number}`,
            invoiceNumber: order.invoice_number,
            customer: {
                name: order.customer_name || "",
                email: order.customer_email || "",
                contact: order.customer_phone || ""
            }
        });

    } catch (error) {
        console.error("Razorpay order creation error:", error);

        return res.status(error.status || 500).json({
            success: false,
            message: error.status === 503
                ? error.message
                : error.message || "Could not start Razorpay checkout."
        });
    }
});

// ==========================================
// CUSTOMER: CREATE SINGLE-USE DYNAMIC UPI QR
// ==========================================

router.post("/:id/payment/qr/create", requireSignedIn, async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const order = await getCustomerOrder(
            db,
            req.params.id,
            req.userId
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (order.status === "cancelled" || order.payment_status === "paid") {
            return res.status(400).json({
                success: false,
                message: order.status === "cancelled"
                    ? "This order has been cancelled."
                    : "This order is already paid."
            });
        }

        const { client, keyId } = getRazorpay();

        if (
            order.gateway_qr_id &&
            order.gateway_qr_status === "active" &&
            Number(order.gateway_qr_close_by || 0) >
                Math.floor(Date.now() / 1000)
        ) {
            const existingQr = await client.qrCode.fetch(
                order.gateway_qr_id
            );

            if (
                existingQr.status === "active" &&
                Number(existingQr.payment_amount) === paise(order.total_amount) &&
                existingQr.image_url
            ) {
                return res.json({
                    success: true,
                    keyId,
                    qrId: existingQr.id,
                    qrImageUrl: existingQr.image_url,
                    qrStatus: existingQr.status,
                    amount: Number(existingQr.payment_amount),
                    currency: "INR",
                    closeBy: existingQr.close_by,
                    invoiceNumber: order.invoice_number
                });
            }
        }

        const closeBy = Math.floor(Date.now() / 1000) + 7200;

        const qr = await client.qrCode.create({
            type: "upi_qr",
            name: "CLEAN WAVE",
            usage: "single_use",
            fixed_amount: true,
            payment_amount: paise(order.total_amount),
            description: `Payment for ${order.invoice_number}`,
            close_by: closeBy,
            notes: {
                clean_wave_order_id: String(order.id),
                invoice_number: String(order.invoice_number),
                customer_user_id: String(req.userId)
            }
        });

        if (!qr.id || !qr.image_url) {
            throw new Error("Razorpay did not return a QR image.");
        }

        const { error } = await db
            .from("orders")
            .update({
                payment_method: "razorpay",
                payment_provider: PAYMENT_PROVIDER,
                gateway_qr_id: qr.id,
                gateway_qr_image_url: qr.image_url,
                gateway_qr_status: qr.status || "active",
                gateway_qr_close_by: qr.close_by || closeBy,
                gateway_payment_status: "qr_created",
                gateway_signature_verified: false
            })
            .eq("id", order.id)
            .eq("user_id", req.userId);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Payment QR created successfully.",
            keyId,
            qrId: qr.id,
            qrImageUrl: qr.image_url,
            qrStatus: qr.status,
            amount: qr.payment_amount,
            currency: "INR",
            closeBy: qr.close_by || closeBy,
            invoiceNumber: order.invoice_number
        });

    } catch (error) {
        console.error("Razorpay QR creation error:", error);

        return res.status(error.status || 500).json({
            success: false,
            message:
                error.error?.description ||
                error.description ||
                error.message ||
                "Could not generate the payment QR code."
        });
    }
});

// ==========================================
// CUSTOMER: VERIFY PAYMENT THROUGH QR RECORDS
// ==========================================

router.post("/:id/payment/qr/refresh", requireSignedIn, async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const order = await getCustomerOrder(
            db,
            req.params.id,
            req.userId
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (order.payment_status === "paid") {
            return res.json({
                success: true,
                captured: true,
                message: "This order is already paid.",
                order: paymentResponse(order)
            });
        }

        if (!order.gateway_qr_id) {
            return res.status(400).json({
                success: false,
                captured: false,
                message: "No payment QR has been generated for this order."
            });
        }

        const { client } = getRazorpay();

        const result = await client.qrCode.fetchAllPayments(
            order.gateway_qr_id,
            { count: 100 }
        );

        const payments = Array.isArray(result.items)
            ? result.items
            : [];

        const matchingPayment = payments.find(payment =>
            Number(payment.amount) === paise(order.total_amount) &&
            String(payment.currency).toUpperCase() === "INR" &&
            payment.status === "captured" &&
            payment.captured === true
        );

        if (matchingPayment) {
            const savedOrder = await markCapturedQrPayment(
                db,
                order,
                matchingPayment
            );

            return res.json({
                success: true,
                captured: true,
                message: "QR payment verified successfully.",
                order: paymentResponse(savedOrder)
            });
        }

        const qr = await client.qrCode.fetch(order.gateway_qr_id);

        await db
            .from("orders")
            .update({
                gateway_qr_status: qr.status || order.gateway_qr_status
            })
            .eq("id", order.id)
            .eq("user_id", req.userId);

        const latestPayment = payments.length
            ? payments[payments.length - 1]
            : null;

        return res.json({
            success: true,
            captured: false,
            message: qr.status === "closed"
                ? "This QR code is closed. Contact CLEAN WAVE if you have already paid."
                : "Payment has not been confirmed yet. Please scan the QR and refresh again.",
            qrStatus: qr.status,
            paymentStatus: latestPayment?.status || "pending",
            order: paymentResponse(order)
        });

    } catch (error) {
        console.error("Razorpay QR verification error:", error);

        return res.status(error.status || 500).json({
            success: false,
            captured: false,
            message:
                error.error?.description ||
                error.description ||
                error.message ||
                "Could not verify QR payment. Please try again."
        });
    }
});

// ==========================================
// CUSTOMER: VERIFY RAZORPAY CHECKOUT PAYMENT
// ==========================================

router.post("/:id/payment/verify", requireSignedIn, async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const razorpayOrderId = String(
            req.body.razorpay_order_id || ""
        );

        const razorpayPaymentId = String(
            req.body.razorpay_payment_id || ""
        );

        const razorpaySignature = String(
            req.body.razorpay_signature || ""
        );

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({
                success: false,
                message: "Razorpay did not return complete payment details."
            });
        }

        const order = await getCustomerOrder(
            db,
            req.params.id,
            req.userId
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (
            !order.gateway_order_id ||
            String(order.gateway_order_id) !== razorpayOrderId
        ) {
            return res.status(400).json({
                success: false,
                message: "Razorpay order does not match this CLEAN WAVE order."
            });
        }

        if (!verifyCheckoutSignature(
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature
        )) {
            return res.status(400).json({
                success: false,
                message: "Razorpay payment signature verification failed."
            });
        }

        const { client } = getRazorpay();

        const payment = await client.payments.fetch(
            razorpayPaymentId
        );

        if (
            String(payment.order_id) !== razorpayOrderId ||
            Number(payment.amount) !== paise(order.total_amount) ||
            String(payment.currency).toUpperCase() !== "INR"
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment amount or order details do not match."
            });
        }

        if (payment.status !== "captured") {
            await db
                .from("orders")
                .update({
                    gateway_payment_id: payment.id,
                    gateway_payment_status: payment.status || "unknown",
                    gateway_signature_verified: true
                })
                .eq("id", order.id)
                .eq("user_id", req.userId);

            return res.status(409).json({
                success: false,
                captured: false,
                paymentStatus: payment.status || "unknown",
                message: payment.status === "authorized"
                    ? "Payment is authorized but not captured yet. Please refresh payment status later."
                    : "Payment has not been captured. You can retry checkout."
            });
        }

        const result = await markCapturedPayment(
            db,
            order,
            payment,
            req.userId
        );

        return res.json({
            success: true,
            captured: true,
            message: "Razorpay payment verified successfully.",
            order: paymentResponse(result.order)
        });

    } catch (error) {
        console.error("Razorpay payment verification error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not verify the Razorpay payment. Please refresh the payment status."
        });
    }
});

// ==========================================
// CUSTOMER: REFRESH PAYMENT FROM RAZORPAY
// ==========================================

router.post("/:id/payment/refresh", requireSignedIn, async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const order = await getCustomerOrder(
            db,
            req.params.id,
            req.userId
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (order.payment_status === "paid") {
            return res.json({
                success: true,
                captured: true,
                message: "This order is already marked as paid.",
                order: paymentResponse(order)
            });
        }

        if (!order.gateway_order_id) {
            return res.json({
                success: true,
                captured: false,
                message: "No Razorpay payment attempt exists yet.",
                order: paymentResponse(order)
            });
        }

        const { client } = getRazorpay();

        const result = await client.orders.fetchPayments(
            order.gateway_order_id
        );

        const payments = Array.isArray(result.items)
            ? result.items
            : [];

        const matchingPayment = payments.find(payment =>
            Number(payment.amount) === paise(order.total_amount) &&
            String(payment.currency).toUpperCase() === "INR" &&
            String(payment.order_id) === String(order.gateway_order_id) &&
            payment.status === "captured" &&
            payment.captured === true
        );

        if (matchingPayment) {
            const saved = await markCapturedPayment(
                db,
                order,
                matchingPayment,
                req.userId
            );

            return res.json({
                success: true,
                captured: true,
                message: "Payment found and verified successfully.",
                order: paymentResponse(saved.order)
            });
        }

        const latestPayment = payments.length
            ? payments[payments.length - 1]
            : null;

        if (latestPayment) {
            await db
                .from("orders")
                .update({
                    gateway_payment_id: latestPayment.id || null,
                    gateway_payment_status: latestPayment.status || "unknown"
                })
                .eq("id", order.id)
                .eq("user_id", req.userId);
        }

        return res.json({
            success: true,
            captured: false,
            message: "No captured payment was found for this order yet.",
            paymentStatus: latestPayment?.status || "pending",
            order: paymentResponse(order)
        });

    } catch (error) {
        console.error("Razorpay payment refresh error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not refresh payment from Razorpay."
        });
    }
});

// ==========================================
// CUSTOMER: VIEW OWN ORDER
// ==========================================

router.get("/:id/customer", requireSignedIn, async (req, res) => {
    try {
        const order = await getCustomerOrder(
            req.app.locals.supabase,
            req.params.id,
            req.userId
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        return res.json({
            success: true,
            order
        });

    } catch (error) {
        console.error("Customer order lookup error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not load your order."
        });
    }
});

// ==========================================
// LEGACY CUSTOMER UPI REFERENCE ROUTE
// ==========================================

router.patch("/:id/payment-reference", requireSignedIn, async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const reference = String(
            req.body.reference || ""
        ).trim();

        if (!/^[A-Za-z0-9-]{6,40}$/.test(reference)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid UPI transaction reference."
            });
        }

        const { data: order, error: lookupError } = await db
            .from("orders")
            .select("id,status,payment_status,payment_provider")
            .eq("id", req.params.id)
            .eq("user_id", req.userId)
            .maybeSingle();

        if (lookupError) throw lookupError;

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (order.payment_provider === PAYMENT_PROVIDER) {
            return res.status(400).json({
                success: false,
                message: "This order uses Razorpay. UPI reference submission is disabled."
            });
        }

        if (
            order.status === "cancelled" ||
            order.payment_status === "paid"
        ) {
            return res.status(400).json({
                success: false,
                message: "This order cannot accept a payment reference."
            });
        }

        const { data, error } = await db
            .from("orders")
            .update({
                payment_reference: reference,
                payment_status: "submitted"
            })
            .eq("id", req.params.id)
            .eq("user_id", req.userId)
            .select("id,payment_status,payment_reference,paid_amount,total_amount")
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            message: "Transaction reference submitted.",
            payment: data
        });

    } catch (error) {
        console.error("Legacy payment reference error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not submit your transaction reference."
        });
    }
});

// ==========================================
// ADMIN: VIEW ALL ORDERS
// ==========================================

router.get("/", requireAdmin, async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("orders")
            .select("*,order_items(*)")
            .order("created_at", { ascending: false });

        if (error) throw error;

        return res.json({
            success: true,
            orders: data || []
        });

    } catch (error) {
        console.error("Admin order list error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not load orders."
        });
    }
});

// ==========================================
// ADMIN: MANUAL PAYMENT VERIFICATION
// ==========================================

router.patch("/:id/payment", requireAdmin, async (req, res) => {
    try {
        const db = req.app.locals.supabase;
        const paidAmount = money(req.body.paidAmount);

        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid paid amount."
            });
        }

        const { data: existing, error: lookupError } = await db
            .from("orders")
            .select("id,total_amount,payment_reference,status,payment_provider,gateway_payment_status")
            .eq("id", req.params.id)
            .maybeSingle();

        if (lookupError) throw lookupError;

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        if (
            existing.payment_provider === PAYMENT_PROVIDER &&
            existing.gateway_payment_status === "captured"
        ) {
            return res.status(400).json({
                success: false,
                message: "This Razorpay payment is already verified. Manual payment changes are disabled."
            });
        }

        const total = money(existing.total_amount);

        if (paidAmount > total) {
            return res.status(400).json({
                success: false,
                message: "Paid amount cannot exceed the order total."
            });
        }

        if (paidAmount > 0 && !existing.payment_reference) {
            return res.status(400).json({
                success: false,
                message: "The customer has not submitted a transaction reference."
            });
        }

        let paymentStatus = "pending";

        if (paidAmount >= total && total > 0) {
            paymentStatus = "paid";
        } else if (paidAmount > 0) {
            paymentStatus = "partially_paid";
        } else if (existing.payment_reference) {
            paymentStatus = "submitted";
        }

        const update = {
            paid_amount: paidAmount,
            payment_status: paymentStatus,
            payment_verified_at: paidAmount > 0
                ? new Date().toISOString()
                : null,
            payment_verified_by: paidAmount > 0
                ? req.userId
                : null
        };

        const { data, error } = await db
            .from("orders")
            .update(update)
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            message: paymentStatus === "paid"
                ? "Full payment verified."
                : paymentStatus === "partially_paid"
                    ? "Partial payment verified."
                    : "Payment verification reset.",
            order: data
        });

    } catch (error) {
        console.error("Manual payment verification error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not update payment verification."
        });
    }
});

// ==========================================
// ADMIN: VIEW ONE ORDER
// ==========================================

router.get("/:id", requireAdmin, async (req, res) => {
    try {
        const { data, error } = await req.app.locals.supabase
            .from("orders")
            .select("*,order_items(*)")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        return res.json({
            success: true,
            order: data
        });

    } catch (error) {
        console.error("Admin order detail error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not load order."
        });
    }
});

// ==========================================
// ADMIN: UPDATE ORDER FULFILMENT STATUS
// ==========================================

router.patch("/:id/status", requireAdmin, async (req, res) => {
    try {
        const allowedStatuses = [
            "pending",
            "confirmed",
            "processing",
            "dispatched",
            "delivered",
            "cancelled"
        ];

        const status = String(req.body.status || "");

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid order status."
            });
        }

        const { data, error } = await req.app.locals.supabase
            .from("orders")
            .update({ status })
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            message: "Order status updated.",
            order: data
        });

    } catch (error) {
        console.error("Order status update error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not update order status."
        });
    }
});

module.exports = router;
