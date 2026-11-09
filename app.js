
"use strict";

/* ==========================================
   CLEAN WAVE - MAIN JAVASCRIPT

   Products + Cart
   Custom Authentication (NO CLERK)
   Razorpay Checkout
   Dynamic UPI QR
   QR Payment Verification
   Invoice + WhatsApp

   Authentication:
   - HTTP-only cw_session cookie
   - /api/auth/me
   - No Clerk SDK
   - No Bearer token
========================================== */

const WHATSAPP_NUMBER = "919724656591";
const CART_KEY = "cleanWaveCart";
const ACTIVE_ORDER_KEY = "cleanWaveActiveOrder";
const PRODUCTS_API = "/api/products/public";

let products = [];
let productsLoaded = false;
let productsLoading = false;
let activeOrder = null;
let razorpayLoadingPromise = null;

// ==========================================
// COMMON HELPERS
// ==========================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function formatPrice(value) {
    return Number(value || 0).toFixed(2);
}

function productImage(product) {
    return product.image_url ||
        product.image ||
        "https://placehold.co/600x400/eaf5ff/062b50?text=CLEAN+WAVE";
}

function showPaymentMessage(message, type = "") {
    const element = document.getElementById("paymentMessage");

    if (!element) return;

    element.textContent = message;
    element.className = `reference-message ${type}`;
}

async function readApiResponse(response) {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
        const responseText = await response.text();

        console.error("Non-JSON API response:", responseText);

        throw new Error(
            `Server returned a non-JSON response (HTTP ${response.status}). Check your API route.`
        );
    }

    return response.json();
}

// ==========================================
// CUSTOM AUTHENTICATION - NO CLERK
// ==========================================

async function getAuthenticatedUser() {
    const response = await fetch("/api/auth/me", {
        method: "GET",
        headers: {
            "Accept": "application/json"
        },
        credentials: "same-origin",
        cache: "no-store"
    });

    const result = await readApiResponse(response);

    if (!response.ok || !result.success || !result.user) {
        if (response.status === 401) {
            window.location.href =
                "login.html?next=" +
                encodeURIComponent("cart.html");

            throw new Error("Please log in to continue.");
        }

        throw new Error(
            result.message || "Could not verify your login."
        );
    }

    const data = result.user;

    return {
        id: data.id,
        fullName: data.full_name || data.fullName || "",
        companyName: data.company_name || data.companyName || "",
        email: data.email || "",
        phone: data.phone || "",
        role: data.role || "customer"
    };
}

// ==========================================
// RAZORPAY SCRIPT LOADER
// ==========================================

async function loadRazorpayScript() {
    if (window.Razorpay) return true;

    if (razorpayLoadingPromise) {
        return razorpayLoadingPromise;
    }

    razorpayLoadingPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(
            'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
        );

        if (existing) {
            existing.addEventListener("load", () => {
                if (window.Razorpay) {
                    resolve(true);
                } else {
                    reject(new Error("Razorpay Checkout could not be initialized."));
                }
            }, { once: true });

            existing.addEventListener("error", () => {
                reject(new Error("Could not load Razorpay Checkout."));
            }, { once: true });

            if (window.Razorpay) resolve(true);

            return;
        }

        const script = document.createElement("script");

        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;

        script.onload = () => {
            if (window.Razorpay) {
                resolve(true);
            } else {
                reject(new Error("Razorpay Checkout could not be initialized."));
            }
        };

        script.onerror = () => {
            reject(new Error("Could not load Razorpay Checkout."));
        };

        document.head.appendChild(script);
    }).catch(error => {
        razorpayLoadingPromise = null;
        throw error;
    });

    return razorpayLoadingPromise;
}

// ==========================================
// LOAD PRODUCTS FROM SERVER
// ==========================================

async function loadProducts() {
    if (productsLoading) return;

    productsLoading = true;

    const grid = document.getElementById("productGrid");

    if (grid) {
        grid.innerHTML = `
            <div class="products-loading">Loading products...</div>
        `;
    }

    try {
        const response = await fetch(PRODUCTS_API, {
            headers: {
                "Accept": "application/json"
            },
            credentials: "same-origin",
            cache: "no-store"
        });

        const result = await readApiResponse(response);

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Could not load products."
            );
        }

        products = (result.products || []).map(product => ({
            ...product,
            id: Number(product.id),
            price: Number(product.selling_price),
            unit: product.unit || "Unit",
            image: product.image_url || ""
        }));

        productsLoaded = true;

        renderProducts();
        renderCart();
        updateCartCount();

        console.log(
            `CLEAN WAVE: ${products.length} products loaded.`
        );

    } catch (error) {
        console.error("Product loading error:", error);

        productsLoaded = false;

        if (grid) {
            grid.innerHTML = `
                <div class="products-error">
                    <h3>Unable to load products</h3>
                    <p>${escapeHTML(error.message)}</p>
                    <button type="button" onclick="loadProducts()">
                        Try Again
                    </button>
                </div>
            `;
        }

        const cartList = document.getElementById("cartList");

        if (cartList) {
            cartList.innerHTML = `
                <div class="cart-empty">
                    <h2>Products could not be loaded</h2>
                    <p>Please check your connection and try again.</p>
                    <button type="button" onclick="loadProducts()">
                        Reload Products
                    </button>
                </div>
            `;
        }

    } finally {
        productsLoading = false;
    }
}

// ==========================================
// CART FUNCTIONS
// ==========================================

function getCart() {
    try {
        const cart = JSON.parse(
            localStorage.getItem(CART_KEY) || "[]"
        );

        return Array.isArray(cart) ? cart : [];

    } catch (error) {
        console.error("Cart loading error:", error);
        return [];
    }
}

function saveCart(cart) {
    localStorage.setItem(
        CART_KEY,
        JSON.stringify(cart)
    );

    updateCartCount();
}

function updateCartCount() {
    const countElement = document.getElementById("cartCount");

    if (!countElement) return;

    const total = getCart().reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
    );

    countElement.textContent = total;
}

function getProductQuantity(productId) {
    const item = getCart().find(
        item => Number(item.id) === Number(productId)
    );

    return item ? Number(item.quantity) : 0;
}

function addToCart(productId) {
    const product = products.find(
        p => Number(p.id) === Number(productId)
    );

    if (!product) {
        alert("This product is unavailable.");
        return;
    }

    const cart = getCart();

    const existing = cart.find(
        item => Number(item.id) === Number(productId)
    );

    if (existing) {
        existing.quantity = Number(existing.quantity) + 1;
    } else {
        cart.push({
            id: Number(productId),
            quantity: 1
        });
    }

    saveCart(cart);
    renderProducts();
    renderCart();
}

function changeQuantity(productId, change) {
    let cart = getCart();

    const item = cart.find(
        item => Number(item.id) === Number(productId)
    );

    if (!item) return;

    item.quantity =
        Number(item.quantity) + Number(change);

    if (item.quantity <= 0) {
        cart = cart.filter(
            item => Number(item.id) !== Number(productId)
        );
    }

    saveCart(cart);
    renderProducts();
    renderCart();
}

function removeFromCart(productId) {
    const cart = getCart().filter(
        item => Number(item.id) !== Number(productId)
    );

    saveCart(cart);
    renderProducts();
    renderCart();
}

// ==========================================
// DISPLAY PRODUCTS
// ==========================================

function renderProducts() {
    const grid = document.getElementById("productGrid");

    if (!grid) return;

    if (!productsLoaded) {
        if (!productsLoading) {
            grid.innerHTML = `
                <div class="products-loading">
                    Products are not available yet.
                </div>
            `;
        }

        return;
    }

    const category = grid.dataset.category || "all";

    const filtered = category === "all"
        ? products
        : products.filter(
            product => product.category === category
        );

    if (!filtered.length) {
        grid.innerHTML = `
            <div class="products-empty">
                <h3>No products available</h3>
                <p>
                    Products in this category will appear here
                    when added by CLEAN WAVE.
                </p>
            </div>
        `;

        return;
    }

    grid.innerHTML = filtered.map(product => {
        const quantity = getProductQuantity(product.id);

        const categoryName =
            String(product.category || "").replace(/-/g, " ");

        return `
            <article class="product-card">
                <img
                    src="${escapeHTML(productImage(product))}"
                    alt="${escapeHTML(product.name)}"
                    loading="lazy"
                    onerror="this.onerror=null;this.src='https://placehold.co/600x400/eaf5ff/062b50?text=CLEAN+WAVE';"
                >

                <div class="product-info">
                    <h3>${escapeHTML(product.name)}</h3>

                    <p class="product-category">
                        ${escapeHTML(categoryName)}
                    </p>

                    ${
                        product.description
                        ? `<p class="product-description">
                            ${escapeHTML(product.description)}
                           </p>`
                        : ""
                    }

                    <p class="product-price">
                        ₹${formatPrice(product.price)}
                        <small>/ ${escapeHTML(product.unit)}</small>
                    </p>

                    ${
                        quantity > 0
                        ? `
                            <div class="product-quantity">
                                <button
                                    type="button"
                                    onclick="changeQuantity(${product.id}, -1)"
                                >−</button>

                                <span>${quantity}</span>

                                <button
                                    type="button"
                                    onclick="changeQuantity(${product.id}, 1)"
                                >+</button>
                            </div>
                        `
                        : `
                            <button
                                type="button"
                                class="add-to-cart"
                                onclick="addToCart(${product.id})"
                            >
                                Add to Cart
                            </button>
                        `
                    }
                </div>
            </article>
        `;
    }).join("");
}

// ==========================================
// DISPLAY CART
// ==========================================

function renderCart() {
    const cartList = document.getElementById("cartList");
    const cartSummary = document.getElementById("cartSummary");

    if (!cartList || !cartSummary) return;

    updateCartCount();

    if (!productsLoaded) {
        cartList.innerHTML = `
            <div class="cart-empty">
                <h2>Loading your cart...</h2>
                <p>Please wait while products are loaded.</p>
            </div>
        `;

        cartSummary.innerHTML = "";
        return;
    }

    const originalCart = getCart();

    const cartProducts = originalCart.map(item => {
        const product = products.find(
            p => Number(p.id) === Number(item.id)
        );

        return product
            ? {
                ...product,
                quantity: Number(item.quantity)
            }
            : null;

    }).filter(Boolean);

    const validIds = new Set(
        cartProducts.map(product => Number(product.id))
    );

    const cleanedCart = originalCart.filter(
        item => validIds.has(Number(item.id))
    );

    if (cleanedCart.length !== originalCart.length) {
        saveCart(cleanedCart);
    }

    if (!cartProducts.length) {
        cartList.innerHTML = `
            <div class="cart-empty">
                <h2>Your cart is empty</h2>
                <p>Add products to your cart to see your order here.</p>
                <a href="index.html#products">Explore Categories</a>
            </div>
        `;

        cartSummary.innerHTML = "";
        return;
    }

    cartList.innerHTML = cartProducts.map(product => `
        <article class="cart-item">
            <div class="cart-item-image">
                <img
                    src="${escapeHTML(productImage(product))}"
                    alt="${escapeHTML(product.name)}"
                    loading="lazy"
                >
            </div>

            <div class="cart-item-details">
                <h3>${escapeHTML(product.name)}</h3>

                <p class="cart-unit">
                    ${escapeHTML(product.unit)}
                </p>

                <p class="cart-price">
                    ₹${formatPrice(product.price)} each
                </p>

                <button
                    type="button"
                    class="remove-btn"
                    onclick="removeFromCart(${product.id})"
                >
                    Remove
                </button>
            </div>

            <div class="cart-item-actions">
                <div class="quantity-control">
                    <button
                        type="button"
                        onclick="changeQuantity(${product.id}, -1)"
                    >−</button>

                    <span>${product.quantity}</span>

                    <button
                        type="button"
                        onclick="changeQuantity(${product.id}, 1)"
                    >+</button>
                </div>

                <div class="cart-item-subtotal">
                    ₹${formatPrice(
                        product.price * product.quantity
                    )}
                </div>
            </div>
        </article>
    `).join("");

    const totalItems = cartProducts.reduce(
        (sum, product) => sum + product.quantity,
        0
    );

    const subtotal = cartProducts.reduce(
        (sum, product) =>
            sum + product.price * product.quantity,
        0
    );

    cartSummary.innerHTML = `
        <div class="cart-summary-card">
            <h2>Order Summary</h2>

            <div class="summary-row">
                <span>Total Items</span>
                <strong>${totalItems}</strong>
            </div>

            <div class="summary-row">
                <span>Subtotal</span>
                <strong>₹${formatPrice(subtotal)}</strong>
            </div>

            <div class="summary-row">
                <span>Delivery</span>
                <strong>To be confirmed</strong>
            </div>

            <div class="summary-total">
                <span>Estimated Total</span>
                <span>₹${formatPrice(subtotal)}</span>
            </div>

            <button
                type="button"
                class="checkout-btn"
                id="checkoutButton"
                onclick="checkoutWhatsApp()"
            >
                Proceed to Checkout & Pay
            </button>

            <p class="checkout-note">
                Secure online payment through Razorpay.
            </p>
        </div>
    `;
}

// ==========================================
// CUSTOMER CHECKOUT - CREATE ORDER
// CUSTOM AUTHENTICATION
// ==========================================

async function checkoutWhatsApp() {
    const cart = getCart();

    if (!cart.length) {
        alert("Your cart is empty.");
        return;
    }

    const button = document.getElementById("checkoutButton");

    if (button) {
        button.disabled = true;
        button.textContent = "Creating your order...";
    }

    try {
        const user = await getAuthenticatedUser();

        const orderItems = cart.map(item => ({
            productId: Number(item.id),
            quantity: Number(item.quantity)
        }));

        if (orderItems.some(item =>
            !Number.isInteger(item.productId) ||
            item.productId <= 0 ||
            !Number.isInteger(item.quantity) ||
            item.quantity <= 0
        )) {
            throw new Error(
                "Your cart contains an invalid product or quantity."
            );
        }

        const response = await fetch("/api/orders", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                customerPhone: user.phone,
                customerName: user.fullName,
                customerEmail: user.email,
                companyName: user.companyName,
                items: orderItems
            })
        });

        const result = await readApiResponse(response);

        if (!response.ok || !result.success || !result.order) {
            throw new Error(
                result.message || "Unable to create your order."
            );
        }

        const saved = result.order;

        const items = (saved.items || []).map(item => ({
            id: item.product_id,
            name: item.product_name,
            unit: item.unit || "Unit",
            price: Number(item.selling_price),
            quantity: Number(item.quantity)
        }));

        if (!items.length) {
            throw new Error(
                "Order was saved, but its product details were not returned."
            );
        }

        const order = {
            id: saved.id,
            invoiceNumber: saved.invoiceNumber,

            customerName:
                user.fullName || "CLEAN WAVE Customer",

            companyName:
                user.companyName || "",

            customerEmail:
                user.email || "",

            customerPhone:
                user.phone || "",

            dateText: new Date().toLocaleDateString("en-IN"),

            items,

            total: Number(saved.total),

            paymentStatus: saved.paymentStatus || "pending",

            paymentMethod: "razorpay",

            paymentReference: "",

            gatewayOrderId: "",
            gatewayPaymentId: "",
            gatewayPaymentStatus: "",

            gatewayQrId: "",
            gatewayQrImageUrl: "",
            gatewayQrStatus: "",

            paidAmount: Number(saved.paidAmount || 0)
        };

        if (!Number.isFinite(order.total) || !order.invoiceNumber) {
            throw new Error(
                "The server returned invalid order details."
            );
        }

        saveCart([]);
        renderProducts();
        renderCart();

        showPaymentPanel(order);

    } catch (error) {
        console.error("CLEAN WAVE checkout error:", error);

        alert(error.message || "Checkout failed. Please try again.");

        if (button) {
            button.disabled = false;
            button.textContent = "Proceed to Checkout & Pay";
        }
    }
}

// ==========================================
// PAYMENT PANEL
// ==========================================

function showPaymentPanel(order) {
    const panel = document.getElementById("checkoutPayment");

    if (!panel) {
        alert("Payment panel is missing from cart.html.");
        return;
    }

    activeOrder = order;

    sessionStorage.setItem(
        ACTIVE_ORDER_KEY,
        JSON.stringify(activeOrder)
    );

    const paid = Number(order.paidAmount || 0);
    const due = Math.max(0, Number(order.total) - paid);
    const isPaid = order.paymentStatus === "paid";

    panel.hidden = false;

    panel.innerHTML = `
        <div class="payment-card">

            <div class="payment-heading">
                <span class="payment-eyebrow">ORDER CREATED</span>
                <h2>${isPaid ? "Payment Completed" : "Complete Your Payment"}</h2>
                <p>Your order has been saved successfully.</p>
            </div>

            <div class="payment-order-info">
                <div>
                    <span>Invoice Number</span>
                    <strong>${escapeHTML(order.invoiceNumber)}</strong>
                </div>

                <div>
                    <span>Customer</span>
                    <strong>${escapeHTML(order.customerName || "")}</strong>
                </div>

                <div>
                    <span>Company / Store</span>
                    <strong>${escapeHTML(order.companyName || "Not provided")}</strong>
                </div>

                <div>
                    <span>Order Total</span>
                    <strong>₹${formatPrice(order.total)}</strong>
                </div>

                <div>
                    <span>Payment Status</span>
                    <strong id="customerPaymentStatus">
                        ${escapeHTML(order.paymentStatus || "pending").toUpperCase()}
                    </strong>
                </div>

                <div>
                    <span>Amount Paid</span>
                    <strong id="customerPaidAmount">₹${formatPrice(paid)}</strong>
                </div>

                <div>
                    <span>Amount Due</span>
                    <strong id="customerDueAmount">₹${formatPrice(due)}</strong>
                </div>
            </div>

            <div class="upi-payment-layout">

                <div class="upi-qr-box">
                    <h3>Scan & Pay with UPI</h3>

                    <div id="qrImageContainer">
                        ${
                            order.gatewayQrImageUrl
                            ? `<img
                                src="${escapeHTML(order.gatewayQrImageUrl)}"
                                alt="CLEAN WAVE UPI QR Code"
                                style="width:240px;max-width:100%;height:auto;"
                            >`
                            : `<div style="font-size:65px;color:#0878bd;padding:30px;">▦</div>
                               <p>Your payment QR will appear here.</p>`
                        }
                    </div>

                    <p id="qrPaymentStatus">
                        ${
                            order.gatewayQrImageUrl
                            ? "QR code generated. Scan using your UPI app."
                            : "Click Generate UPI QR to create your payment code."
                        }
                    </p>
                </div>

                <div class="upi-details">
                    <h3>Order Payment</h3>

                    <p class="upi-payee">
                        <span>Merchant</span>
                        <strong>CLEAN WAVE</strong>
                    </p>

                    <p class="upi-payee">
                        <span>Invoice</span>
                        <strong>${escapeHTML(order.invoiceNumber)}</strong>
                    </p>

                    <p class="upi-amount">
                        Amount to pay
                        <strong id="qrAmountDue">₹${formatPrice(due)}</strong>
                    </p>

                    <button
                        type="button"
                        class="upi-pay-button"
                        id="generateQrButton"
                        ${isPaid ? "disabled" : ""}
                    >
                        ${order.gatewayQrImageUrl ? "Generate New QR" : "Generate UPI QR"}
                    </button>

                    <button
                        type="button"
                        class="refresh-payment-action"
                        id="refreshQrButton"
                        style="margin-top:10px;"
                        ${isPaid || !order.gatewayQrId ? "disabled" : ""}
                    >
                        Verify QR Payment
                    </button>

                    <hr style="margin:20px 0;">

                    <h3>Alternative Payment</h3>

                    <button
                        type="button"
                        class="upi-pay-button"
                        id="razorpayPayButton"
                        style="background:#075985;"
                        ${isPaid ? "disabled" : ""}
                    >
                        ${isPaid ? "Payment Completed" : "Pay with Razorpay Checkout"}
                    </button>

                    <p class="upi-help">
                        You can use Razorpay Checkout if QR generation is unavailable.
                    </p>
                </div>

            </div>

            <p id="paymentMessage"
               class="reference-message"
               aria-live="polite"></p>

            <div class="payment-actions">
                <button type="button" class="invoice-action"
                    id="downloadInvoiceButton">
                    Download Invoice
                </button>

                <button type="button" class="whatsapp-action"
                    id="orderWhatsAppButton">
                    Order on WhatsApp
                </button>

                <button type="button" class="refresh-payment-action"
                    id="refreshPaymentButton">
                    Verify / Refresh Payment
                </button>
            </div>

            <p class="payment-warning">
                Keep this page open while completing your payment.
            </p>

        </div>
    `;

    document.getElementById("generateQrButton")
        .addEventListener("click", generateUpiQr);

    document.getElementById("refreshQrButton")
        .addEventListener("click", refreshQrPaymentStatus);

    document.getElementById("razorpayPayButton")
        .addEventListener("click", startRazorpayPayment);

    document.getElementById("downloadInvoiceButton")
        .addEventListener("click", downloadInvoice);

    document.getElementById("orderWhatsAppButton")
        .addEventListener("click", orderOnWhatsApp);

    document.getElementById("refreshPaymentButton")
        .addEventListener("click", refreshPaymentStatus);

    panel.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// ==========================================
// GENERATE DYNAMIC RAZORPAY UPI QR
// ==========================================

async function generateUpiQr() {
    if (!activeOrder || !activeOrder.id) {
        showPaymentMessage("No active order found.", "error");
        return;
    }

    if (activeOrder.paymentStatus === "paid") {
        showPaymentMessage("This order is already paid.", "success");
        return;
    }

    const button = document.getElementById("generateQrButton");

    if (button) {
        button.disabled = true;
        button.textContent = "Generating QR...";
    }

    try {
        await getAuthenticatedUser();

        const response = await fetch(
            `/api/orders/${encodeURIComponent(activeOrder.id)}/payment/qr/create`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const result = await readApiResponse(response);

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Razorpay could not generate the QR code."
            );
        }

        const qrImageUrl = result.qrImageUrl || result.image_url;

        if (!qrImageUrl) {
            throw new Error(
                "Razorpay response did not contain a QR image URL."
            );
        }

        activeOrder.gatewayQrId =
            result.qrCodeId || result.qrId || result.id || "";

        activeOrder.gatewayQrImageUrl = qrImageUrl;
        activeOrder.gatewayQrStatus = result.status || "active";

        sessionStorage.setItem(
            ACTIVE_ORDER_KEY,
            JSON.stringify(activeOrder)
        );

        const container = document.getElementById("qrImageContainer");

        if (container) {
            container.innerHTML = `
                <img
                    src="${escapeHTML(qrImageUrl)}"
                    alt="CLEAN WAVE UPI Payment QR"
                    style="
                        width:240px;
                        max-width:100%;
                        height:auto;
                        display:block;
                        margin:auto;
                    "
                >
            `;
        }

        const status = document.getElementById("qrPaymentStatus");

        if (status) {
            status.textContent =
                "QR generated successfully. Scan using your UPI app.";
        }

        const refreshButton = document.getElementById("refreshQrButton");

        if (refreshButton) {
            refreshButton.disabled = false;
        }

        if (button) {
            button.disabled = false;
            button.textContent = "Generate New QR";
        }

        showPaymentMessage(
            "UPI QR generated successfully. Scan and pay ₹" +
            formatPrice(activeOrder.total) + ".",
            "success"
        );

    } catch (error) {
        console.error("UPI QR generation error:", error);

        showPaymentMessage(error.message, "error");

        if (button) {
            button.disabled = false;
            button.textContent = "Generate UPI QR";
        }
    }
}

// ==========================================
// VERIFY RAZORPAY UPI QR PAYMENT
// ==========================================

async function refreshQrPaymentStatus() {
    if (!activeOrder || !activeOrder.id) return;

    if (!activeOrder.gatewayQrId) {
        showPaymentMessage(
            "Generate a UPI QR code before checking its payment.",
            "error"
        );
        return;
    }

    const button = document.getElementById("refreshQrButton");

    if (button) {
        button.disabled = true;
        button.textContent = "Checking payment...";
    }

    try {
        await getAuthenticatedUser();

        const response = await fetch(
            `/api/orders/${encodeURIComponent(activeOrder.id)}/payment/qr/refresh`,
            {
                method: "POST",
                headers: {
                    "Accept": "application/json"
                },
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const result = await readApiResponse(response);

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Unable to verify QR payment."
            );
        }

        const saved = result.order;

        if (saved) {
            activeOrder.paymentStatus =
                saved.paymentStatus || activeOrder.paymentStatus;

            activeOrder.paidAmount =
                Number(saved.paidAmount ?? activeOrder.paidAmount);

            activeOrder.total =
                Number(saved.total ?? activeOrder.total);

            activeOrder.gatewayPaymentId =
                saved.gatewayPaymentId || activeOrder.gatewayPaymentId;

            activeOrder.gatewayPaymentStatus =
                saved.gatewayPaymentStatus ||
                activeOrder.gatewayPaymentStatus;

            activeOrder.gatewayQrStatus =
                saved.gatewayQrStatus || activeOrder.gatewayQrStatus;
        }

        sessionStorage.setItem(
            ACTIVE_ORDER_KEY,
            JSON.stringify(activeOrder)
        );

        updatePaymentDetails();

        const payButton = document.getElementById("razorpayPayButton");
        const generateButton = document.getElementById("generateQrButton");

        if (activeOrder.paymentStatus === "paid" || result.captured === true) {
            activeOrder.paymentStatus = "paid";
            activeOrder.paidAmount = Number(activeOrder.total);

            sessionStorage.setItem(
                ACTIVE_ORDER_KEY,
                JSON.stringify(activeOrder)
            );

            if (payButton) {
                payButton.disabled = true;
                payButton.textContent = "Payment Completed";
            }

            if (generateButton) {
                generateButton.disabled = true;
                generateButton.textContent = "Payment Completed";
            }

            if (button) {
                button.textContent = "Payment Verified";
            }

            updatePaymentDetails();

            showPaymentMessage(
                "Payment verified successfully! Your order is PAID.",
                "success"
            );

        } else {
            showPaymentMessage(
                result.message ||
                "Payment is not captured yet. Complete your UPI payment and check again.",
                ""
            );

            if (button) {
                button.disabled = false;
                button.textContent = "Verify QR Payment";
            }
        }

    } catch (error) {
        console.error("QR payment verification error:", error);

        showPaymentMessage(error.message, "error");

        if (button) {
            button.disabled = false;
            button.textContent = "Verify QR Payment";
        }
    }
}

// ==========================================
// START RAZORPAY CHECKOUT
// ==========================================

async function startRazorpayPayment() {
    if (!activeOrder) {
        alert("No active order was found.");
        return;
    }

    const button = document.getElementById("razorpayPayButton");

    if (button) {
        button.disabled = true;
        button.textContent = "Opening secure checkout...";
    }

    try {
        await loadRazorpayScript();

        if (!window.Razorpay) {
            throw new Error(
                "Razorpay Checkout could not be initialized."
            );
        }

        const user = await getAuthenticatedUser();

        const response = await fetch(
            `/api/orders/${encodeURIComponent(activeOrder.id)}/payment/create`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                credentials: "same-origin"
            }
        );

        const result = await readApiResponse(response);

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Could not start payment."
            );
        }

        activeOrder.gatewayOrderId = result.razorpayOrderId;

        sessionStorage.setItem(
            ACTIVE_ORDER_KEY,
            JSON.stringify(activeOrder)
        );

        const options = {
            key: result.keyId,
            amount: result.amount,
            currency: result.currency,
            name: result.name || "CLEAN WAVE",
            description: result.description || "CLEAN WAVE Order",
            order_id: result.razorpayOrderId,

            prefill: {
                name: result.customer?.name || user.fullName,
                email: result.customer?.email || user.email,
                contact: result.customer?.contact || user.phone
            },

            notes: {
                invoice_number: activeOrder.invoiceNumber
            },

            theme: {
                color: "#0878bd"
            },

            handler: async function (paymentResult) {
                await verifyRazorpayPayment(paymentResult);
            },

            modal: {
                ondismiss: function () {
                    if (button) {
                        button.disabled = false;
                        button.textContent = "Pay with Razorpay Checkout";
                    }

                    showPaymentMessage(
                        "Checkout was closed. Your order is still saved. You can try again.",
                        "error"
                    );
                }
            }
        };

        const checkout = new window.Razorpay(options);

        checkout.on("payment.failed", function (failure) {
            console.error("Razorpay payment failed:", failure);

            const description =
                failure.error?.description ||
                "The payment was not completed.";

            showPaymentMessage(
                `${description} You can retry payment.`,
                "error"
            );

            if (button) {
                button.disabled = false;
                button.textContent = "Pay with Razorpay Checkout";
            }
        });

        checkout.open();

    } catch (error) {
        console.error("Razorpay checkout error:", error);

        showPaymentMessage(error.message, "error");

        if (button) {
            button.disabled = false;
            button.textContent = "Pay with Razorpay Checkout";
        }
    }
}

// ==========================================
// VERIFY RAZORPAY CHECKOUT PAYMENT
// ==========================================

async function verifyRazorpayPayment(paymentResult) {
    const button = document.getElementById("razorpayPayButton");

    if (button) {
        button.disabled = true;
        button.textContent = "Verifying payment...";
    }

    showPaymentMessage(
        "Verifying payment securely with CLEAN WAVE server...",
        ""
    );

    try {
        await getAuthenticatedUser();

        const response = await fetch(
            `/api/orders/${encodeURIComponent(activeOrder.id)}/payment/verify`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    razorpay_order_id: paymentResult.razorpay_order_id,
                    razorpay_payment_id: paymentResult.razorpay_payment_id,
                    razorpay_signature: paymentResult.razorpay_signature
                })
            }
        );

        const result = await readApiResponse(response);

        if (!response.ok || !result.success) {
            if (result.paymentStatus) {
                activeOrder.gatewayPaymentStatus = result.paymentStatus;
            }

            if (paymentResult.razorpay_payment_id) {
                activeOrder.gatewayPaymentId =
                    paymentResult.razorpay_payment_id;
            }

            sessionStorage.setItem(
                ACTIVE_ORDER_KEY,
                JSON.stringify(activeOrder)
            );

            throw new Error(
                result.message || "Payment verification is not complete."
            );
        }

        const saved = result.order || {};

        activeOrder.paymentStatus = saved.paymentStatus || "paid";

        activeOrder.paidAmount =
            Number(saved.paidAmount ?? activeOrder.total);

        activeOrder.gatewayOrderId =
            saved.gatewayOrderId || paymentResult.razorpay_order_id;

        activeOrder.gatewayPaymentId =
            saved.gatewayPaymentId || paymentResult.razorpay_payment_id;

        activeOrder.gatewayPaymentStatus =
            saved.gatewayPaymentStatus || "captured";

        sessionStorage.setItem(
            ACTIVE_ORDER_KEY,
            JSON.stringify(activeOrder)
        );

        updatePaymentDetails();

        if (button) {
            button.disabled = activeOrder.paymentStatus === "paid";
            button.textContent =
                activeOrder.paymentStatus === "paid"
                ? "Payment Completed"
                : "Pay with Razorpay Checkout";
        }

        showPaymentMessage(
            activeOrder.paymentStatus === "paid"
                ? "Payment verified successfully! Your CLEAN WAVE order is PAID."
                : "Payment verification is pending. Please refresh payment status.",
            activeOrder.paymentStatus === "paid" ? "success" : ""
        );

    } catch (error) {
        console.error("Payment verification error:", error);

        showPaymentMessage(
            `${error.message} Use Verify / Refresh Payment to check again.`,
            "error"
        );

        if (button && activeOrder.paymentStatus !== "paid") {
            button.disabled = false;
            button.textContent = "Pay with Razorpay Checkout";
        }
    }
}

// ==========================================
// REFRESH RAZORPAY CHECKOUT PAYMENT STATUS
// ==========================================

async function refreshPaymentStatus() {
    if (!activeOrder || !activeOrder.id) {
        showPaymentMessage("No active order found.", "error");
        return;
    }

    const button = document.getElementById("refreshPaymentButton");

    if (button) {
        button.disabled = true;
        button.textContent = "Checking Razorpay...";
    }

    try {
        await getAuthenticatedUser();

        const response = await fetch(
            `/api/orders/${encodeURIComponent(activeOrder.id)}/payment/refresh`,
            {
                method: "POST",
                headers: {
                    "Accept": "application/json"
                },
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        const result = await readApiResponse(response);

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Could not refresh payment status."
            );
        }

        const saved = result.order;

        if (saved) {
            activeOrder.paymentStatus =
                saved.paymentStatus || activeOrder.paymentStatus;

            activeOrder.paidAmount =
                Number(saved.paidAmount ?? activeOrder.paidAmount);

            activeOrder.total =
                Number(saved.total ?? activeOrder.total);

            activeOrder.gatewayOrderId =
                saved.gatewayOrderId || activeOrder.gatewayOrderId;

            activeOrder.gatewayPaymentId =
                saved.gatewayPaymentId || activeOrder.gatewayPaymentId;

            activeOrder.gatewayPaymentStatus =
                saved.gatewayPaymentStatus ||
                activeOrder.gatewayPaymentStatus;
        }

        sessionStorage.setItem(
            ACTIVE_ORDER_KEY,
            JSON.stringify(activeOrder)
        );

        updatePaymentDetails();

        const payButton = document.getElementById("razorpayPayButton");

        if (activeOrder.paymentStatus === "paid") {
            if (payButton) {
                payButton.disabled = true;
                payButton.textContent = "Payment Completed";
            }

            showPaymentMessage(
                "Payment verified successfully. Your order is PAID.",
                "success"
            );

        } else {
            if (payButton) {
                payButton.disabled = false;
                payButton.textContent = "Pay with Razorpay Checkout";
            }

            showPaymentMessage(
                result.message ||
                "Payment is not captured yet. You can retry checkout.",
                ""
            );
        }

    } catch (error) {
        console.error("Payment refresh error:", error);

        showPaymentMessage(error.message, "error");

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Verify / Refresh Payment";
        }
    }
}

// ==========================================
// UPDATE PAYMENT DETAILS
// ==========================================

function updatePaymentDetails() {
    if (!activeOrder) return;

    const status = document.getElementById("customerPaymentStatus");
    const paid = document.getElementById("customerPaidAmount");
    const due = document.getElementById("customerDueAmount");
    const amountDue = document.getElementById("qrAmountDue");

    const paidAmount = Number(activeOrder.paidAmount || 0);

    const dueAmount = Math.max(
        0,
        Number(activeOrder.total) - paidAmount
    );

    if (status) {
        status.textContent =
            String(activeOrder.paymentStatus || "pending")
                .replace(/_/g, " ")
                .toUpperCase();
    }

    if (paid) {
        paid.textContent = `₹${formatPrice(paidAmount)}`;
    }

    if (due) {
        due.textContent = `₹${formatPrice(dueAmount)}`;
    }

    if (amountDue) {
        amountDue.textContent = `₹${formatPrice(dueAmount)}`;
    }
}

// ==========================================
// DOWNLOAD / PRINT INVOICE
// ==========================================

function downloadInvoice() {
    if (!activeOrder) return;

    const order = activeOrder;

    const rows = order.items.map(item => `
        <tr>
            <td>${escapeHTML(item.name)}</td>
            <td>${escapeHTML(item.unit)}</td>
            <td>${Number(item.quantity)}</td>
            <td>₹${formatPrice(item.price)}</td>
            <td>₹${formatPrice(item.price * item.quantity)}</td>
        </tr>
    `).join("");

    const paid = Number(order.paidAmount || 0);

    const due = Math.max(
        0,
        Number(order.total) - paid
    );

    const invoiceWindow = window.open("", "_blank");

    if (!invoiceWindow) {
        alert("Please allow pop-ups to print or save your invoice.");
        return;
    }

    const invoiceHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">

            <title>
                ${escapeHTML(order.invoiceNumber)} - CLEAN WAVE
            </title>

            <style>
                body{
                    font-family:Arial,sans-serif;
                    color:#26384a;
                    padding:25px
                }

                .header{
                    background:#083d69;
                    color:white;
                    padding:22px
                }

                .details{
                    display:flex;
                    justify-content:space-between;
                    gap:20px;
                    margin:25px 0
                }

                table{
                    width:100%;
                    border-collapse:collapse;
                    margin-top:20px
                }

                th,td{
                    padding:11px;
                    border:1px solid #dce4ec;
                    text-align:left
                }

                th{background:#e8f1f9}

                .totals{
                    text-align:right;
                    margin-top:22px;
                    line-height:1.9
                }

                .status{
                    font-weight:bold;
                    color:#083d69
                }

                .note{
                    margin-top:30px;
                    background:#f2f6fa;
                    padding:15px;
                    font-size:12px;
                    line-height:1.6
                }

                .print{
                    margin-top:20px;
                    padding:12px 20px;
                    background:#083d69;
                    color:white;
                    border:0;
                    cursor:pointer
                }

                @media print{
                    .print{display:none}
                    body{padding:0}
                }

                @media(max-width:600px){
                    body{padding:10px}
                    .details{flex-direction:column}
                    table{font-size:12px}
                    th,td{padding:6px}
                }
            </style>
        </head>

        <body>
            <div class="header">
                <h1>CLEAN WAVE</h1>
                <p>Industrial & Cleaning Chemicals</p>
                <p>Palsana, Surat, Gujarat, India</p>
            </div>

            <div class="details">
                <div>
                    <strong>Invoice / Order Reference</strong><br>
                    ${escapeHTML(order.invoiceNumber)}<br><br>

                    <strong>Date:</strong><br>
                    ${escapeHTML(order.dateText)}
                </div>

                <div>
                    <strong>Customer</strong><br>
                    ${escapeHTML(order.customerName)}<br>
                    ${escapeHTML(order.companyName || "")}<br>
                    ${escapeHTML(order.customerEmail)}<br>
                    ${escapeHTML(order.customerPhone)}
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Product</th>
                        <th>Unit</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Amount</th>
                    </tr>
                </thead>

                <tbody>${rows}</tbody>
            </table>

            <div class="totals">
                <strong>Order Total: ₹${formatPrice(order.total)}</strong><br>
                Amount Paid: ₹${formatPrice(paid)}<br>
                Amount Due: ₹${formatPrice(due)}<br>

                Payment Status:
                <span class="status">
                    ${escapeHTML(order.paymentStatus || "pending")
                        .replace(/_/g, " ")
                        .toUpperCase()}
                </span><br>

                Payment Provider: Razorpay<br>
                Razorpay Payment ID:
                ${escapeHTML(order.gatewayPaymentId || "Not available")}
            </div>

            <div class="note">
                This is a provisional order invoice, not a GST tax invoice.
                Payment is considered complete only after server-side
                verification. Product availability, delivery charges,
                applicable taxes and final payable amount must be
                confirmed by CLEAN WAVE.
            </div>

            <button class="print" onclick="window.print()">
                Print / Save as PDF
            </button>
        </body>
        </html>
    `;

    invoiceWindow.document.open();
    invoiceWindow.document.write(invoiceHTML);
    invoiceWindow.document.close();
}

// ==========================================
// ORDER ON WHATSAPP
// ==========================================

function orderOnWhatsApp() {
    if (!activeOrder) return;

    const order = activeOrder;

    const lines = order.items.map(item =>
        `${item.name} (${item.unit}) x ${item.quantity} = INR ${formatPrice(
            item.price * item.quantity
        )}`
    );

    const message = [
        "Hello CLEAN WAVE, I have created an order.",
        "",
        `Invoice: ${order.invoiceNumber}`,
        `Customer: ${order.customerName}`,
        `Company / Store: ${order.companyName || "Not provided"}`,
        `Phone: ${order.customerPhone || "Not provided"}`,
        "",
        "ORDER DETAILS:",
        ...lines,
        "",
        `Order Total: INR ${formatPrice(order.total)}`,
        `Amount Paid: INR ${formatPrice(order.paidAmount || 0)}`,
        `Payment Status: ${order.paymentStatus || "pending"}`,
        "Payment Provider: Razorpay",
        `Razorpay Payment ID: ${order.gatewayPaymentId || "Not available"}`,
        "",
        "Please confirm product availability, delivery charges and final amount."
    ].join("\n");

    window.open(
        `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`,
        "_blank",
        "noopener"
    );
}

// ==========================================
// RESTORE PAYMENT PANEL AFTER REFRESH
// ==========================================

function restoreActiveOrder() {
    const panel = document.getElementById("checkoutPayment");

    if (!panel) return;

    try {
        const saved = sessionStorage.getItem(ACTIVE_ORDER_KEY);

        if (!saved) return;

        const order = JSON.parse(saved);

        if (
            order &&
            order.id &&
            order.invoiceNumber &&
            Array.isArray(order.items)
        ) {
            showPaymentPanel(order);
        }

    } catch (error) {
        console.error("Could not restore checkout:", error);

        sessionStorage.removeItem(ACTIVE_ORDER_KEY);
    }
}

// ==========================================
// MOBILE NAVIGATION
// ==========================================

function setupMobileMenu() {
    const menuToggle = document.getElementById("menuToggle");
    const navbar = document.getElementById("navbar");

    if (!menuToggle || !navbar) return;

    menuToggle.addEventListener("click", () => {
        const isOpen = navbar.classList.toggle("open");

        menuToggle.setAttribute(
            "aria-expanded",
            String(isOpen)
        );
    });

    navbar.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => {
            navbar.classList.remove("open");

            menuToggle.setAttribute(
                "aria-expanded",
                "false"
            );
        });
    });

    document.addEventListener("click", event => {
        if (
            !navbar.contains(event.target) &&
            !menuToggle.contains(event.target)
        ) {
            navbar.classList.remove("open");

            menuToggle.setAttribute(
                "aria-expanded",
                "false"
            );
        }
    });
}

// ==========================================
// PAGE INITIALIZATION
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    updateCartCount();
    setupMobileMenu();
    restoreActiveOrder();
    loadProducts();
});
