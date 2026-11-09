
"use strict";

const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../auth");

const {
    getReportingSettings,
    getISTDateParts,
    getMonthRange
} = require("../reporting-utils");

router.use(requireAdmin);

router.get("/", async (req, res) => {
    try {
        const db = req.app.locals.supabase;
        const settings = await getReportingSettings(db);

        const [
            ordersResult,
            expensesResult,
            productsResult,
            customersResult
        ] = await Promise.all([
            (() => {
                let query = db
                    .from("orders")
                    .select("id,total_amount,status,created_at");

                if (settings.is_active) {
                    const start = getMonthRange(
                        settings.start_date.slice(0, 7),
                        settings.start_date
                    );

                    query = query.gte(
                        "created_at",
                        new Date(
                            `${settings.start_date}T00:00:00+05:30`
                        ).toISOString()
                    );
                }

                return query;
            })(),

            (() => {
                let query = db
                    .from("expenses")
                    .select("amount,expense_date");

                if (settings.is_active) {
                    query = query.gte(
                        "expense_date",
                        settings.start_date
                    );
                }

                return query;
            })(),

            db.from("products")
                .select(
                    "id,name,sku,stock_quantity,low_stock_threshold,is_active"
                ),

            db.from("customers").select("id")
        ]);

        for (const result of [
            ordersResult,
            expensesResult,
            productsResult,
            customersResult
        ]) {
            if (result.error) throw result.error;
        }

        const orders = ordersResult.data || [];
        const expenses = expensesResult.data || [];
        const allProducts = productsResult.data || [];
        const customers = customersResult.data || [];

        const activeProducts = allProducts.filter(
            product => product.is_active === true
        );

        const salesOrders = orders.filter(
            order => order.status !== "cancelled"
        );

        const totalSales = salesOrders.reduce(
            (sum, order) =>
                sum + Number(order.total_amount || 0),
            0
        );

        const totalExpenses = expenses.reduce(
            (sum, expense) =>
                sum + Number(expense.amount || 0),
            0
        );

        const pendingOrders = orders.filter(
            order => order.status === "pending"
        ).length;

        const lowStockProducts = activeProducts.filter(product => {
            const stock = Number(product.stock_quantity || 0);
            const threshold = Number(
                product.low_stock_threshold ?? 5
            );

            return stock <= threshold;
        });

        const today = getISTDateParts();
        const monthlySales = [];

        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date(
                Date.UTC(today.year, today.month - 1 - i, 1)
            );

            const year = monthDate.getUTCFullYear();
            const monthNumber = monthDate.getUTCMonth() + 1;

            const monthValue =
                `${year}-${String(monthNumber).padStart(2, "0")}`;

            const monthStart = `${monthValue}-01`;

            const monthRange = getMonthRange(
                monthValue,
                settings.is_active ? settings.start_date : null
            );

            const isBeforeReportingStart =
                settings.is_active &&
                monthRange.endDateExclusive <= settings.start_date;

            const sales = isBeforeReportingStart
                ? 0
                : salesOrders
                    .filter(order => {
                        if (!order.created_at) return false;

                        const timestamp =
                            new Date(order.created_at).getTime();

                        return (
                            timestamp >= new Date(
                                monthRange.startTimestamp
                            ).getTime() &&
                            timestamp < new Date(
                                monthRange.endTimestamp
                            ).getTime()
                        );
                    })
                    .reduce(
                        (sum, order) =>
                            sum + Number(order.total_amount || 0),
                        0
                    );

            monthlySales.push({
                month: new Intl.DateTimeFormat("en-IN", {
                    month: "short",
                    year: "numeric",
                    timeZone: "Asia/Kolkata"
                }).format(new Date(Date.UTC(year, monthNumber - 1, 15))),
                monthKey: monthValue,
                sales,
                partialMonth:
                    settings.is_active &&
                    monthStart < settings.start_date &&
                    monthRange.startDate === settings.start_date
            });
        }

        const monthlySalesWithGrowth = monthlySales.map(
            (item, index) => {
                const previous = index > 0
                    ? monthlySales[index - 1].sales
                    : 0;

                let growthPercent = null;

                if (index > 0) {
                    growthPercent = previous > 0
                        ? ((item.sales - previous) / previous) * 100
                        : item.sales > 0 ? 100 : 0;
                }

                return {
                    ...item,
                    growthPercent
                };
            }
        );

        res.set(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, private"
        );

        res.json({
            success: true,
            reporting: {
                active: settings.is_active,
                startDate: settings.start_date,
                timezone: settings.timezone
            },
            dashboard: {
                totalSales,
                totalExpenses,
                estimatedProfit: totalSales - totalExpenses,
                totalOrders: orders.length,
                pendingOrders,
                totalProducts: activeProducts.length,
                totalCustomers: customers.length,
                monthlySales: monthlySalesWithGrowth,
                lowStockCount: lowStockProducts.length,
                lowStockProducts
            }
        });

    } catch (error) {
        console.error("Dashboard API error:", error);

        res.status(500).json({
            success: false,
            message: error.message ||
                "Could not load dashboard information."
        });
    }
});

module.exports = router;
