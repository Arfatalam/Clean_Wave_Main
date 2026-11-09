"use strict";

/* ==========================================
   CLEAN WAVE - ADMIN PANEL
   Custom Authentication (No Clerk)
   Dashboard + Products + Orders
   Expenses + Inventory + Customers
   Product Image Upload
========================================== */

const ADMIN_EMAILS = new Set([
    "arfatalam786123@gmail.com",
    "alamkureshi05@gmail.com",
    "cleanwavechemicals.sale@gmail.com",
    "sameer.kureshi.0117@gmail.com"
]);

let currentAdmin = null;
let dashboardData = null;
let cachedProducts = [];
let cachedExpenses = [];
let previewObjectURL = null;

const $ = id => document.getElementById(id);

// ==========================================
// HELPERS
// ==========================================

function showMessage(message, type = "info") {
    const box = $("adminMessage");
    if (!box) return;

    box.textContent = message;
    box.className = `admin-message ${type}`;
    box.style.display = "block";
}

function hideMessage() {
    if ($("adminMessage")) {
        $("adminMessage").style.display = "none";
    }
}

function setText(id, value) {
    if ($(id)) {
        $(id).textContent = value;
    }
}

function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2
    }).format(Number(value) || 0);
}

function formatNumber(value) {
    return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

function localDateString() {
    const date = new Date();

    return new Date(
        date.getTime() - date.getTimezoneOffset() * 60000
    ).toISOString().slice(0, 10);
}

function getAdminLoginURL() {
    const url = new URL("/login.html", window.location.origin);
    url.searchParams.set("next", "admin.html");
    return url.href;
}

function redirectToAdminLogin() {
    window.location.replace(getAdminLoginURL());
}

// ==========================================
// CUSTOM AUTHENTICATION
// ==========================================

async function initializeAdmin() {
    try {
        showMessage("Checking administrator login...", "info");

        const response = await fetch("/api/auth/me", {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "Accept": "application/json"
            }
        });

        const result = await response.json().catch(() => ({}));

        if (response.status === 401) {
            redirectToAdminLogin();
            return;
        }

        if (!response.ok || !result.success || !result.user) {
            throw new Error(
                result.message || "Unable to verify your login session."
            );
        }

        currentAdmin = result.user;

        const email = String(currentAdmin.email || "")
            .trim()
            .toLowerCase();

        if (!ADMIN_EMAILS.has(email)) {
            showMessage(
                "Access denied. This account is not an authorized administrator.",
                "error"
            );
            return;
        }

        const displayName =
            currentAdmin.full_name ||
            currentAdmin.name ||
            currentAdmin.company_name ||
            email;

        setText("adminUser", displayName);

        await loadDashboard();

        console.log("CLEAN WAVE Admin Panel initialized.");

    } catch (error) {
        console.error("Admin initialization error:", error);

        showMessage(
            error.message || "Unable to initialize admin panel.",
            "error"
        );
    }
}

// ==========================================
// API HELPER
// ==========================================

async function apiRequest(url, options = {}) {
    const isFormData = options.body instanceof FormData;

    const headers = {
        "Accept": "application/json",
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin",
        cache: "no-store"
    });

    const result = await response.json().catch(() => ({}));

    if (response.status === 401) {
        redirectToAdminLogin();

        throw new Error(
            "Your session has expired. Please sign in again."
        );
    }

    if (response.status === 403) {
        throw new Error(
            result.message || "Administrator access denied."
        );
    }

    if (!response.ok) {
        throw new Error(
            result.message || `Server error (${response.status}).`
        );
    }

    return result;
}



// ==========================================
// REPORTING, BACKUP AND MONTHLY STATEMENTS
// ==========================================

async function downloadFile(url, fallbackFilename) {
    const response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
            "Accept": "*/*"
        }
    });

    if (response.status === 401) {
        redirectToAdminLogin();
        throw new Error("Your session has expired. Please sign in again.");
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
            error.message || `Download failed (${response.status}).`
        );
    }

    const blob = await response.blob();

    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || fallbackFilename;

    const objectURL = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectURL;
    anchor.download = filename;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}

async function downloadBusinessBackup() {
    const button = $("downloadBackupBtn");

    try {
        if (button) {
            button.disabled = true;
            button.textContent = "Creating Backup...";
        }

        showMessage(
            "Creating a backup of orders, order items, expenses, customers, products and inventory history...",
            "info"
        );

        await downloadFile(
            "/api/backup",
            "clean-wave-business-backup.json"
        );

        showMessage(
            "Backup generated. Check your browser downloads before activating reporting.",
            "success"
        );

    } catch (error) {
        console.error("Backup download error:", error);
        showMessage(error.message, "error");

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Download Business Backup";
        }
    }
}

async function activateReporting() {
    const button = $("activateReportingBtn");

    if (!confirm(
        "Have you downloaded and checked your CLEAN WAVE business backup? " +
        "Activating will make dashboard sales, orders and expenses start " +
        "from 9 November 2026. Older records will remain in the database."
    )) {
        return;
    }

    try {
        if (button) {
            button.disabled = true;
            button.textContent = "Activating...";
        }

        const result = await apiRequest("/api/reports/activate", {
            method: "POST",
            body: JSON.stringify({})
        });

        showMessage(
            result.message || "Reporting period activated.",
            "success"
        );

        await loadDashboard();

    } catch (error) {
        console.error("Reporting activation error:", error);
        showMessage(error.message, "error");

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Activate Reporting from 9 Nov 2026";
        }
    }
}

async function downloadMonthlyStatement(format) {
    const month = $("reportMonth")?.value;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        showMessage("Please select a valid statement month.", "error");
        return;
    }

    const button = format === "pdf"
        ? $("downloadPdfBtn")
        : $("downloadExcelBtn");

    const originalText = format === "pdf"
        ? "Download Monthly PDF"
        : "Download Monthly Excel";

    try {
        if (button) {
            button.disabled = true;
            button.textContent = "Preparing Statement...";
        }

        showMessage(
            `Preparing the ${month} monthly statement...`,
            "info"
        );

        const url =
            `/api/reports/monthly?month=${encodeURIComponent(month)}` +
            `&format=${encodeURIComponent(format)}`;

        const extension = format === "pdf" ? "pdf" : "xlsx";

        await downloadFile(
            url,
            `clean-wave-${month}-statement.${extension}`
        );

        showMessage(
            `${month} statement downloaded successfully.`,
            "success"
        );

    } catch (error) {
        console.error("Monthly statement error:", error);
        showMessage(error.message, "error");

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

// ==========================================
// DASHBOARD
// ==========================================

async function loadDashboard() {
    const button = $("refreshDashboard");

    if (button) {
        button.disabled = true;
        button.textContent = "Refreshing...";
    }

    try {
        const result = await apiRequest("/api/dashboard", {
            method: "GET",
            headers: {
                "Cache-Control": "no-cache"
            }
        });

        if (!result.success || !result.dashboard) {
            throw new Error("Dashboard API returned invalid data.");
        }

        dashboardData = result.dashboard;

renderDashboard(dashboardData);

if (result.reporting?.active) {
    setText(
        "reportingStatus",
        `Reporting is ACTIVE from ${result.reporting.startDate}. Timezone: ${result.reporting.timezone}.`
    );

    if ($("reportingStatus")) {
        $("reportingStatus").className = "admin-message success";
    }

    if ($("activateReportingBtn")) {
        $("activateReportingBtn").disabled = true;
        $("activateReportingBtn").textContent = "Reporting Activated";
    }

} else {
    setText(
        "reportingStatus",
        "Reporting is not activated. Download your business backup before activating."
    );

    if ($("reportingStatus")) {
        $("reportingStatus").className = "admin-message info";
    }

    if ($("activateReportingBtn")) {
        $("activateReportingBtn").disabled = false;
        $("activateReportingBtn").textContent =
            "Activate Reporting from 9 Nov 2026";
    }
}

        hideMessage();

    } catch (error) {
        console.error("Dashboard loading error:", error);

        showMessage(
            error.message || "Unable to refresh dashboard statistics.",
            "error"
        );

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Refresh Statistics";
        }
    }
}

function renderDashboard(data) {
    const totalSales = Number(data.totalSales || 0);
    const totalExpenses = Number(data.totalExpenses || 0);

    // Required calculation:
    // Profit = Total Sales - Total Expenses
    const profit = totalSales - totalExpenses;

    setText("totalSales", formatCurrency(totalSales));
    setText("totalExpenses", formatCurrency(totalExpenses));
    setText("estimatedProfit", formatCurrency(profit));

    setText("totalOrders", formatNumber(data.totalOrders));
    setText("pendingOrders", formatNumber(data.pendingOrders));
    setText("totalProducts", formatNumber(data.totalProducts));
    setText("totalCustomers", formatNumber(data.totalCustomers));
    setText("lowStockCount", formatNumber(data.lowStockCount));

    const currentMonth = Array.isArray(data.monthlySales)
        ? data.monthlySales[data.monthlySales.length - 1]
        : null;

    setText(
        "currentMonthSales",
        formatCurrency(currentMonth?.sales || 0)
    );

    renderLowStockProducts(data.lowStockProducts || []);
    renderMonthlySales(data.monthlySales || []);
}

function renderLowStockProducts(products) {
    const container = $("lowStockProducts");
    if (!container) return;

    if (!products.length) {
        container.innerHTML = "<p>No low-stock products.</p>";
        return;
    }

    container.innerHTML = products.map(product => `
        <div class="admin-list-item">
            <div>
                <strong>${escapeHTML(product.name)}</strong><br>
                <small>SKU: ${escapeHTML(product.sku || "-")}</small>
            </div>

            <span class="stock-warning">
                ${formatNumber(product.stock_quantity)} left
            </span>
        </div>
    `).join("");
}

// ==========================================
// MONTHLY SALES AND GROWTH CHART
// ==========================================

function renderMonthlySales(months) {
    const container = $("monthlySales");
    if (!container) return;

    if (!Array.isArray(months) || !months.length) {
        container.innerHTML = "<p>No monthly sales data available.</p>";
        return;
    }

    const maxSales = Math.max(
        ...months.map(item => Number(item.sales) || 0),
        1
    );

    container.innerHTML = `
        <div class="sales-chart">

            ${months.map((item, index) => {
                const sales = Number(item.sales) || 0;

                const width = sales > 0
                    ? Math.max((sales / maxSales) * 100, 2)
                    : 0;

                let growth = item.growthPercent;

                // Calculate growth on the frontend if the API
                // does not provide it.
                if (growth === undefined && index > 0) {
                    const previous =
                        Number(months[index - 1].sales) || 0;

                    growth = previous > 0
                        ? ((sales - previous) / previous) * 100
                        : sales > 0 ? 100 : 0;
                }

                let growthText = "First month";
                let growthClass = "sales-growth-neutral";

                if (growth !== null && growth !== undefined) {
                    if (growth > 0) {
                        growthText =
                            `▲ ${Number(growth).toFixed(1)}% growth`;

                        growthClass = "sales-growth-positive";

                    } else if (growth < 0) {
                        growthText =
                            `▼ ${Math.abs(Number(growth)).toFixed(1)}% decline`;

                        growthClass = "sales-growth-negative";

                    } else {
                        growthText = "No change";
                    }
                }

                return `
                    <div class="sales-chart-row">

                        <div class="sales-chart-label">
                            ${escapeHTML(item.month)}
                        </div>

                        <div class="sales-chart-track">
                            <div
                                class="sales-chart-bar"
                                style="width:${width}%"
                            ></div>
                        </div>

                        <div class="sales-chart-details">
                            <strong>${formatCurrency(sales)}</strong>

                            <span class="${growthClass}">
                                ${growthText}
                            </span>
                        </div>

                    </div>
                `;
            }).join("")}

        </div>
    `;
}

// ==========================================
// NAVIGATION
// ==========================================

function showSection(sectionName) {
    document.querySelectorAll(".admin-section").forEach(section => {
        section.classList.remove("active");
        section.style.display = "none";
    });

    const selected = $(`${sectionName}Section`);

    if (!selected) {
        showMessage(
            `Section "${sectionName}" was not found.`,
            "error"
        );
        return;
    }

    selected.classList.add("active");
    selected.style.display = "block";

    document.querySelectorAll("[data-section]").forEach(link => {
        link.classList.toggle(
            "active",
            link.dataset.section === sectionName
        );
    });

    setText(
        "pageTitle",
        sectionName.charAt(0).toUpperCase() + sectionName.slice(1)
    );

    hideMessage();

    switch (sectionName) {
        case "dashboard":
            loadDashboard();
            break;

        case "products":
            loadProducts();
            break;

        case "orders":
            loadOrders();
            break;

        case "expenses":
            loadExpenses();
            break;

        case "customers":
            loadCustomers();
            break;

        case "inventory":
            loadInventory();
            break;
    }
}

// ==========================================
// PRODUCT IMAGE METHOD + PREVIEW
// ==========================================

function getImageMethod() {
    return document.querySelector(
        'input[name="imageMethod"]:checked'
    )?.value || "url";
}

function updateImageMethod() {
    const method = getImageMethod();

    if ($("imageUrlArea")) {
        $("imageUrlArea").style.display =
            method === "url" ? "block" : "none";
    }

    if ($("imageGalleryArea")) {
        $("imageGalleryArea").style.display =
            method === "gallery" ? "block" : "none";
    }

    if (method === "url") {
        const url = $("productImage")?.value.trim();

        if (url) {
            showImagePreview(url);
        } else {
            clearImagePreview();
        }

    } else if ($("productImageFile")?.files?.[0]) {
        showLocalImagePreview($("productImageFile").files[0]);

    } else {
        clearImagePreview();
    }
}

function showImagePreview(url) {
    const preview = $("productImagePreview");
    if (!preview || !url) return;

    preview.onerror = () => {
        preview.style.display = "none";
    };

    preview.onload = () => {
        preview.style.display = "block";
    };

    preview.src = url;
}

function showLocalImagePreview(file) {
    if (!file) return;

    if (previewObjectURL) {
        URL.revokeObjectURL(previewObjectURL);
    }

    previewObjectURL = URL.createObjectURL(file);

    showImagePreview(previewObjectURL);
}

function clearImagePreview() {
    const preview = $("productImagePreview");

    if (preview) {
        preview.removeAttribute("src");
        preview.style.display = "none";
    }

    if (previewObjectURL) {
        URL.revokeObjectURL(previewObjectURL);
        previewObjectURL = null;
    }
}

function validateImageFile(file) {
    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
    ];

    if (!allowedTypes.includes(file.type)) {
        throw new Error("Choose a JPG, PNG, WEBP or GIF image.");
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error("Image size must not exceed 5 MB.");
    }
}

async function uploadProductImage(file) {
    validateImageFile(file);

    const formData = new FormData();
    formData.append("image", file);

    const result = await apiRequest(
        "/api/products/upload-image",
        {
            method: "POST",
            body: formData
        }
    );

    if (!result.image_url) {
        throw new Error(
            "Image upload completed but no image URL was returned."
        );
    }

    return result.image_url;
}

// ==========================================
// PRODUCTS
// ==========================================

async function loadProducts() {
    const container = $("productsTableBody");

    try {
        if (container) {
            container.innerHTML =
                "<tr><td colspan='7'>Loading products...</td></tr>";
        }

        const result = await apiRequest("/api/products");

        cachedProducts = result.products || [];

        renderProductsTable(cachedProducts);

    } catch (error) {
        console.error("Products loading error:", error);

        if (container) {
            container.innerHTML = `
                <tr>
                    <td colspan="7">${escapeHTML(error.message)}</td>
                </tr>
            `;
        }

        showMessage(error.message, "error");
    }
}

function renderProductsTable(products) {
    const container = $("productsTableBody");
    if (!container) return;

    if (!products.length) {
        container.innerHTML =
            "<tr><td colspan='7'>No products found. Add your first product above.</td></tr>";
        return;
    }

    container.innerHTML = products.map(product => `
        <tr>
            <td>${escapeHTML(product.name)}</td>
            <td>${escapeHTML(product.category)}</td>
            <td>${escapeHTML(product.sku || "-")}</td>
            <td>${formatCurrency(product.selling_price)}</td>
            <td>${formatNumber(product.stock_quantity)}</td>
            <td>${product.is_active ? "Active" : "Inactive"}</td>

            <td>
                <button
                    type="button"
                    class="admin-button small"
                    data-edit-product="${Number(product.id)}"
                >Edit</button>

                ${product.is_active
                    ? `<button
                        type="button"
                        class="admin-button danger small"
                        data-delete-product="${Number(product.id)}"
                    >Deactivate</button>`
                    : ""}
            </td>
        </tr>
    `).join("");
}

function clearProductForm() {
    $("productForm")?.reset();

    if ($("productId")) $("productId").value = "";
    if ($("productStock")) $("productStock").value = "0";
    if ($("productThreshold")) $("productThreshold").value = "5";
    if ($("productActive")) $("productActive").value = "true";

    const urlMethod = document.querySelector(
        'input[name="imageMethod"][value="url"]'
    );

    if (urlMethod) urlMethod.checked = true;

    if ($("productImage")) $("productImage").value = "";
    if ($("productImageFile")) $("productImageFile").value = "";

    updateImageMethod();
    clearImagePreview();

    setText("saveProductBtn", "Add Product");
}

function editProduct(productId) {
    const product = cachedProducts.find(
        item => Number(item.id) === Number(productId)
    );

    if (!product) {
        showMessage("Product not found.", "error");
        return;
    }

    $("productId").value = product.id;
    $("productName").value = product.name || "";
    $("productCategory").value = product.category || "industrial";
    $("productSku").value = product.sku || "";
    $("productUnit").value = product.unit || "";
    $("productSellingPrice").value = product.selling_price ?? 0;
    $("productStock").value = product.stock_quantity ?? 0;
    $("productThreshold").value = product.low_stock_threshold ?? 5;
    $("productImage").value = product.image_url || "";
    $("productDescription").value = product.description || "";
    $("productActive").value = String(product.is_active !== false);

    if ($("productImageFile")) {
        $("productImageFile").value = "";
    }

    const urlMethod = document.querySelector(
        'input[name="imageMethod"][value="url"]'
    );

    if (urlMethod) urlMethod.checked = true;

    updateImageMethod();

    if (product.image_url) {
        showImagePreview(product.image_url);
    }

    setText("saveProductBtn", "Update Product");

    $("productForm").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

async function saveProduct(event) {
    event.preventDefault();

    const productId = $("productId").value;
    const imageMethod = getImageMethod();

    // Cost price intentionally omitted from this request.
    const product = {
        name: $("productName").value.trim(),
        category: $("productCategory").value,
        sku: $("productSku").value.trim(),
        unit: $("productUnit").value.trim(),
        selling_price: Number($("productSellingPrice").value),
        stock_quantity: Number($("productStock").value || 0),
        low_stock_threshold: Number($("productThreshold").value || 0),
        image_url: $("productImage").value.trim(),
        description: $("productDescription").value.trim(),
        is_active: $("productActive").value === "true"
    };

    const saveButton = $("saveProductBtn");

    try {
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = "Saving...";
        }

        if (imageMethod === "gallery") {
            const file = $("productImageFile")?.files?.[0];

            if (file) {
                showMessage("Uploading product image...", "info");

                product.image_url = await uploadProductImage(file);

            } else if (!productId && !product.image_url) {
                throw new Error(
                    "Please choose an image from your gallery."
                );
            }

        } else {
            const imageURL = $("productImage").value.trim();

            if (
                imageURL &&
                !/^https?:\/\/\S+$/i.test(imageURL)
            ) {
                throw new Error(
                    "Enter a valid image URL starting with http:// or https://."
                );
            }

            product.image_url = imageURL;
        }

        const result = await apiRequest(
            productId
                ? `/api/products/${encodeURIComponent(productId)}`
                : "/api/products",
            {
                method: productId ? "PUT" : "POST",
                body: JSON.stringify(product)
            }
        );

        showMessage(
            result.message || "Product saved successfully.",
            "success"
        );

        clearProductForm();

        await loadProducts();
        await loadDashboard();

    } catch (error) {
        console.error("Save product error:", error);
        showMessage(error.message, "error");

    } finally {
        if (saveButton) {
            saveButton.disabled = false;

            setText(
                "saveProductBtn",
                $("productId")?.value ? "Update Product" : "Add Product"
            );
        }
    }
}

async function deactivateProduct(productId) {
    const product = cachedProducts.find(
        item => Number(item.id) === Number(productId)
    );

    if (!product || !confirm(`Deactivate "${product.name}"?`)) {
        return;
    }

    try {
        const result = await apiRequest(
            `/api/products/${encodeURIComponent(productId)}`,
            { method: "DELETE" }
        );

        showMessage(
            result.message || "Product deactivated.",
            "success"
        );

        await loadProducts();
        await loadDashboard();

    } catch (error) {
        showMessage(error.message, "error");
    }
}

// ==========================================
// ORDERS
// ==========================================

async function loadOrders() {
    const container = $("ordersTableBody");

    try {
        const result = await apiRequest("/api/orders");
        const orders = result.orders || [];

        if (!container) return;

        if (!orders.length) {
            container.innerHTML =
                "<tr><td colspan='6'>No orders found.</td></tr>";
            return;
        }

        container.innerHTML = orders.map(order => `
            <tr>
                <td>${escapeHTML(order.invoice_number || order.id)}</td>
                <td>${escapeHTML(order.customer_name || "-")}</td>
                <td>${escapeHTML(order.customer_phone || "-")}</td>
                <td>${formatCurrency(order.total_amount)}</td>

                <td>
                    <select data-order-status="${escapeHTML(order.id)}">
                        ${[
                            "pending",
                            "confirmed",
                            "processing",
                            "dispatched",
                            "delivered",
                            "cancelled"
                        ].map(status => `
                            <option
                                value="${status}"
                                ${order.status === status ? "selected" : ""}
                            >${status}</option>
                        `).join("")}
                    </select>
                </td>

                <td>
                    ${order.created_at
                        ? new Date(order.created_at).toLocaleDateString("en-IN")
                        : "-"}
                </td>
            </tr>
        `).join("");

    } catch (error) {
        console.error("Orders loading error:", error);

        if (container) {
            container.innerHTML = `
                <tr>
                    <td colspan="6">${escapeHTML(error.message)}</td>
                </tr>
            `;
        }

        showMessage(error.message, "error");
    }
}

async function updateOrderStatus(orderId, status) {
    try {
        const result = await apiRequest(
            `/api/orders/${encodeURIComponent(orderId)}/status`,
            {
                method: "PATCH",
                body: JSON.stringify({ status })
            }
        );

        showMessage(
            result.message || "Order status updated.",
            "success"
        );

        await loadOrders();
        await loadDashboard();

    } catch (error) {
        showMessage(error.message, "error");
        await loadOrders();
    }
}

// ==========================================
// EXPENSES
// ==========================================

async function loadExpenses() {
    const container = $("expensesTableBody");

    try {
        if (container) {
            container.innerHTML =
                "<tr><td colspan='6'>Loading expenses...</td></tr>";
        }

        const result = await apiRequest("/api/expenses");

        cachedExpenses = result.expenses || [];

        renderExpenses(cachedExpenses);

    } catch (error) {
        console.error("Expenses loading error:", error);

        if (container) {
            container.innerHTML = `
                <tr>
                    <td colspan="6">${escapeHTML(error.message)}</td>
                </tr>
            `;
        }

        showMessage(error.message, "error");
    }
}

function renderExpenses(expenses) {
    const container = $("expensesTableBody");
    if (!container) return;

    const total = expenses.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
    );

    setText("expenseTotal", formatCurrency(total));

    if (!expenses.length) {
        container.innerHTML =
            "<tr><td colspan='6'>No expenses found.</td></tr>";
        return;
    }

    container.innerHTML = expenses.map(expense => `
        <tr>
            <td>${escapeHTML(expense.title || "-")}</td>
            <td>${escapeHTML(expense.category || "-").replaceAll("_", " ")}</td>
            <td>${formatCurrency(expense.amount)}</td>
            <td>${escapeHTML(expense.expense_date || "-")}</td>
            <td>${escapeHTML(expense.payment_method || "-")}</td>

            <td>
                <button
                    type="button"
                    class="admin-button small"
                    data-edit-expense="${Number(expense.id)}"
                >Edit</button>

                <button
                    type="button"
                    class="admin-button danger small"
                    data-delete-expense="${Number(expense.id)}"
                >Delete</button>
            </td>
        </tr>
    `).join("");
}

function clearExpenseForm() {
    $("expenseForm")?.reset();

    if ($("expenseId")) $("expenseId").value = "";

    if ($("expenseDate")) {
        $("expenseDate").value = localDateString();
    }

    setText("saveExpenseBtn", "Add Expense");
}

function editExpense(expenseId) {
    const expense = cachedExpenses.find(
        item => Number(item.id) === Number(expenseId)
    );

    if (!expense) {
        showMessage("Expense not found.", "error");
        return;
    }

    $("expenseId").value = expense.id;
    $("expenseTitle").value = expense.title || "";
    $("expenseCategory").value = expense.category || "other";
    $("expenseAmount").value = expense.amount || "";
    $("expenseDate").value =
        expense.expense_date || localDateString();
    $("expensePaymentMethod").value =
        expense.payment_method || "";
    $("expenseReference").value =
        expense.reference_number || "";
    $("expenseNotes").value = expense.notes || "";

    setText("saveExpenseBtn", "Update Expense");

    $("expenseForm").scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

async function saveExpense(event) {
    event.preventDefault();

    const expenseId = $("expenseId").value;

    const expense = {
        title: $("expenseTitle").value.trim(),
        category: $("expenseCategory").value,
        amount: Number($("expenseAmount").value),
        expense_date: $("expenseDate").value,
        payment_method: $("expensePaymentMethod").value,
        reference_number: $("expenseReference").value.trim(),
        notes: $("expenseNotes").value.trim()
    };

    try {
        const result = await apiRequest(
            expenseId
                ? `/api/expenses/${encodeURIComponent(expenseId)}`
                : "/api/expenses",
            {
                method: expenseId ? "PUT" : "POST",
                body: JSON.stringify(expense)
            }
        );

        showMessage(
            result.message || "Expense saved successfully.",
            "success"
        );

        clearExpenseForm();

        await loadExpenses();
        await loadDashboard();

    } catch (error) {
        console.error("Save expense error:", error);
        showMessage(error.message, "error");
    }
}

async function deleteExpense(expenseId) {
    const expense = cachedExpenses.find(
        item => Number(item.id) === Number(expenseId)
    );

    if (
        !expense ||
        !confirm(
            `Delete expense "${expense.title}"? This cannot be undone.`
        )
    ) {
        return;
    }

    try {
        const result = await apiRequest(
            `/api/expenses/${encodeURIComponent(expenseId)}`,
            { method: "DELETE" }
        );

        showMessage(
            result.message || "Expense deleted.",
            "success"
        );

        await loadExpenses();
        await loadDashboard();

    } catch (error) {
        showMessage(error.message, "error");
    }
}

// ==========================================
// CUSTOMERS
// ==========================================

async function loadCustomers() {
    const container = $("customersTableBody");

    try {
        const result = await apiRequest("/api/customers");
        const customers = result.customers || [];

        if (!container) return;

        if (!customers.length) {
            container.innerHTML =
                "<tr><td colspan='4'>No customers found.</td></tr>";
            return;
        }

        container.innerHTML = customers.map(customer => `
            <tr>
                <td>${escapeHTML(customer.name || "-")}</td>
                <td>${escapeHTML(customer.email || "-")}</td>
                <td>${escapeHTML(customer.phone || "-")}</td>
                <td>${escapeHTML(customer.address || "-")}</td>
            </tr>
        `).join("");

    } catch (error) {
        console.error("Customers loading error:", error);

        if (container) {
            container.innerHTML = `
                <tr>
                    <td colspan="4">${escapeHTML(error.message)}</td>
                </tr>
            `;
        }

        showMessage(error.message, "error");
    }
}

// ==========================================
// INVENTORY
// ==========================================

async function loadInventory() {
    const stockContainer = $("inventoryTableBody");
    const historyContainer = $("inventoryHistoryBody");

    try {
        if (stockContainer) {
            stockContainer.innerHTML =
                "<tr><td colspan='6'>Loading current stock...</td></tr>";
        }

        if (historyContainer) {
            historyContainer.innerHTML =
                "<tr><td colspan='5'>Loading transaction history...</td></tr>";
        }

        const [stockResult, historyResult] = await Promise.all([
            apiRequest("/api/inventory"),
            apiRequest("/api/inventory/history")
        ]);

        renderInventoryStock(stockResult.inventory || []);
        renderInventoryHistory(historyResult.transactions || []);

        await loadInventoryProductOptions();

    } catch (error) {
        console.error("Inventory loading error:", error);

        if (stockContainer) {
            stockContainer.innerHTML = `
                <tr>
                    <td colspan="6">${escapeHTML(error.message)}</td>
                </tr>
            `;
        }

        if (historyContainer) {
            historyContainer.innerHTML = `
                <tr>
                    <td colspan="5">${escapeHTML(error.message)}</td>
                </tr>
            `;
        }

        showMessage(error.message, "error");
    }
}

function renderInventoryStock(products) {
    const container = $("inventoryTableBody");
    if (!container) return;

    if (!products.length) {
        container.innerHTML =
            "<tr><td colspan='6'>No products found.</td></tr>";
        return;
    }

    container.innerHTML = products.map(product => {
        const quantity = Number(product.stock_quantity || 0);
        const threshold = Number(product.low_stock_threshold || 0);
        const lowStock = quantity <= threshold;

        return `
            <tr>
                <td>${escapeHTML(product.name)}</td>
                <td>${escapeHTML(product.category || "-")}</td>
                <td>${escapeHTML(product.sku || "-")}</td>

                <td class="${lowStock ? "stock-warning" : ""}">
                    ${formatNumber(quantity)}
                    ${escapeHTML(product.unit || "")}
                    ${lowStock ? " (Low)" : ""}
                </td>

                <td>${formatNumber(threshold)}</td>
                <td>${product.is_active ? "Active" : "Inactive"}</td>
            </tr>
        `;
    }).join("");
}

function renderInventoryHistory(transactions) {
    const container = $("inventoryHistoryBody");
    if (!container) return;

    if (!transactions.length) {
        container.innerHTML =
            "<tr><td colspan='5'>No stock transactions recorded yet.</td></tr>";
        return;
    }

    container.innerHTML = transactions.map(item => {
        const productName = Array.isArray(item.products)
            ? item.products[0]?.name
            : item.products?.name;

        const quantity = Number(item.quantity || 0);

        const quantityText = quantity > 0
            ? `+${quantity}`
            : String(quantity);

        return `
            <tr>
                <td>
                    ${escapeHTML(
                        productName || "Product #" + item.product_id
                    )}
                </td>

                <td>${escapeHTML(quantityText)}</td>
                <td>${escapeHTML(item.transaction_type || "-")}</td>
                <td>${escapeHTML(item.notes || "-")}</td>

                <td>
                    ${item.created_at
                        ? new Date(item.created_at).toLocaleString("en-IN")
                        : "-"}
                </td>
            </tr>
        `;
    }).join("");
}

async function loadInventoryProductOptions() {
    const select = $("inventoryProduct");
    if (!select) return;

    const result = await apiRequest("/api/products");

    cachedProducts = result.products || [];

    const activeProducts = cachedProducts.filter(
        product => product.is_active !== false
    );

    if (!activeProducts.length) {
        select.innerHTML =
            '<option value="">No active products available</option>';
        return;
    }

    select.innerHTML = `
        <option value="">Select a product</option>

        ${activeProducts.map(product => `
            <option value="${Number(product.id)}">
                ${escapeHTML(product.name)}
                — Stock: ${formatNumber(product.stock_quantity)}
            </option>
        `).join("")}
    `;
}

async function adjustInventory(event) {
    event.preventDefault();

    const productId = Number($("inventoryProduct").value);
    const direction = $("inventoryDirection").value;
    const quantity = Number($("inventoryQuantity").value);
    const notes = $("inventoryNotes").value.trim();

    if (!productId || !Number.isInteger(productId)) {
        showMessage("Please select a product.", "error");
        return;
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
        showMessage(
            "Enter a valid whole-number quantity.",
            "error"
        );
        return;
    }

    const product = cachedProducts.find(
        item => Number(item.id) === productId
    );

    if (!product) {
        showMessage(
            "Selected product was not found. Refresh the page.",
            "error"
        );
        return;
    }

    if (
        direction === "remove" &&
        quantity > Number(product.stock_quantity || 0)
    ) {
        showMessage(
            "You cannot remove more stock than is available.",
            "error"
        );
        return;
    }

    if (!confirm(
        `${direction.toUpperCase()} ${quantity} units ${
            direction === "add" ? "to" : "from"
        } ${product.name}?`
    )) {
        return;
    }

    try {
        const result = await apiRequest(
            "/api/inventory/adjust",
            {
                method: "POST",
                body: JSON.stringify({
                    product_id: productId,
                    direction,
                    quantity,
                    notes
                })
            }
        );

        showMessage(
            result.message || "Stock updated successfully.",
            "success"
        );

        clearInventoryForm();

        await loadInventory();
        await loadProducts();
        await loadDashboard();

    } catch (error) {
        console.error("Inventory adjustment error:", error);
        showMessage(error.message, "error");
    }
}

function clearInventoryForm() {
    $("inventoryForm")?.reset();
}

// ==========================================
// LOGOUT - CUSTOM AUTHENTICATION
// ==========================================

async function adminLogout() {
    const logoutButton = $("logoutBtn");

    try {
        if (logoutButton) {
            logoutButton.disabled = true;
            logoutButton.textContent = "Signing out...";
        }

        const response = await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok && response.status !== 401) {
            const result = await response.json().catch(() => ({}));

            throw new Error(
                result.message || "Unable to sign out."
            );
        }

        window.location.replace("/login.html");

    } catch (error) {
        console.error("Admin logout error:", error);

        showMessage(error.message, "error");

        if (logoutButton) {
            logoutButton.disabled = false;
            logoutButton.textContent = "Sign Out";
        }
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    // Sidebar navigation
    document.querySelectorAll("[data-section]").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            showSection(link.dataset.section);
        });
    });

    // Reporting and backup
$("downloadBackupBtn")?.addEventListener(
    "click",
    downloadBusinessBackup
);

$("activateReportingBtn")?.addEventListener(
    "click",
    activateReporting
);

$("downloadPdfBtn")?.addEventListener("click", () => {
    downloadMonthlyStatement("pdf");
});

$("downloadExcelBtn")?.addEventListener("click", () => {
    downloadMonthlyStatement("excel");
});
    // Dashboard
    $("logoutBtn")?.addEventListener("click", adminLogout);
    $("refreshDashboard")?.addEventListener("click", loadDashboard);

    // Products
    $("productForm")?.addEventListener("submit", saveProduct);

    $("cancelProductEdit")?.addEventListener(
        "click",
        clearProductForm
    );

    document.querySelectorAll(
        'input[name="imageMethod"]'
    ).forEach(input => {
        input.addEventListener("change", updateImageMethod);
    });

    $("productImage")?.addEventListener("input", () => {
        if (getImageMethod() === "url") {
            const url = $("productImage").value.trim();

            if (url) {
                showImagePreview(url);
            } else {
                clearImagePreview();
            }
        }
    });

    $("productImageFile")?.addEventListener("change", event => {
        const file = event.target.files?.[0];

        if (!file) {
            clearImagePreview();
            return;
        }

        try {
            validateImageFile(file);
            showLocalImagePreview(file);

        } catch (error) {
            event.target.value = "";
            clearImagePreview();
            showMessage(error.message, "error");
        }
    });

    $("productsTableBody")?.addEventListener("click", event => {
        const editButton = event.target.closest(
            "[data-edit-product]"
        );

        const deleteButton = event.target.closest(
            "[data-delete-product]"
        );

        if (editButton) {
            editProduct(Number(editButton.dataset.editProduct));
        }

        if (deleteButton) {
            deactivateProduct(
                Number(deleteButton.dataset.deleteProduct)
            );
        }
    });

    // Orders
    $("ordersTableBody")?.addEventListener("change", event => {
        const select = event.target.closest("[data-order-status]");

        if (select) {
            updateOrderStatus(
                select.dataset.orderStatus,
                select.value
            );
        }
    });

    // Expenses
    $("expenseForm")?.addEventListener("submit", saveExpense);

    $("cancelExpenseEdit")?.addEventListener(
        "click",
        clearExpenseForm
    );

    $("expensesTableBody")?.addEventListener("click", event => {
        const editButton = event.target.closest(
            "[data-edit-expense]"
        );

        const deleteButton = event.target.closest(
            "[data-delete-expense]"
        );

        if (editButton) {
            editExpense(Number(editButton.dataset.editExpense));
        }

        if (deleteButton) {
            deleteExpense(Number(deleteButton.dataset.deleteExpense));
        }
    });

    // Inventory
    $("inventoryForm")?.addEventListener(
        "submit",
        adjustInventory
    );

    $("clearInventoryForm")?.addEventListener(
        "click",
        clearInventoryForm
    );

    if ($("expenseDate")) {
        $("expenseDate").value = localDateString();
    }

    // Start custom authentication.
    initializeAdmin();
});

// ==========================================
// GLOBAL FUNCTIONS
// ==========================================

window.showSection = showSection;
window.adminLogout = adminLogout;
window.loadDashboard = loadDashboard;
window.loadProducts = loadProducts;
window.loadOrders = loadOrders;
window.loadExpenses = loadExpenses;
window.loadCustomers = loadCustomers;
window.loadInventory = loadInventory;
window.editProduct = editProduct;
window.clearProductForm = clearProductForm;
window.saveProduct = saveProduct;