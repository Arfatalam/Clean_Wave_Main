
"use strict";

const express = require("express");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

const router = express.Router();
const { requireAdmin } = require("../auth");

const {
    getReportingSettings,
    getMonthRange,
    previousMonth,
    formatMonthLabel
} = require("../reporting-utils");

router.use(requireAdmin);

async function getMonthData(db, month, reportingStartDate) {
    const range = getMonthRange(month, reportingStartDate);

    const [
        ordersResult,
        expensesResult
    ] = await Promise.all([
        db.from("orders")
            .select(
                "id,invoice_number,customer_name,status,total_amount,created_at"
            )
            .gte("created_at", range.startTimestamp)
            .lt("created_at", range.endTimestamp)
            .order("created_at", { ascending: true }),

        db.from("expenses")
            .select(
                "id,title,category,amount,expense_date,payment_method,reference_number,notes"
            )
            .gte("expense_date", range.startDate)
            .lt("expense_date", range.endDateExclusive)
            .order("expense_date", { ascending: true })
    ]);

    if (ordersResult.error) throw ordersResult.error;
    if (expensesResult.error) throw expensesResult.error;

    const orders = ordersResult.data || [];
    const expenses = expensesResult.data || [];

    const salesOrders = orders.filter(
        order => order.status !== "cancelled"
    );

    const sales = salesOrders.reduce(
        (sum, order) => sum + Number(order.total_amount || 0),
        0
    );

    const expenseTotal = expenses.reduce(
        (sum, expense) => sum + Number(expense.amount || 0),
        0
    );

    const statusCounts = {
        pending: 0,
        confirmed: 0,
        processing: 0,
        dispatched: 0,
        delivered: 0,
        cancelled: 0,
        other: 0
    };

    for (const order of orders) {
        const status = String(order.status || "").toLowerCase();

        if (Object.prototype.hasOwnProperty.call(statusCounts, status)) {
            statusCounts[status]++;
        } else {
            statusCounts.other++;
        }
    }

    return {
        month,
        monthLabel: formatMonthLabel(month),
        startDate: range.startDate,
        endDate: range.endDateExclusive,
        orders,
        expenses,
        salesOrders,
        sales,
        expensesTotal: expenseTotal,
        estimatedProfit: sales - expenseTotal,
        totalOrders: orders.length,
        salesOrderCount: salesOrders.length,
        statusCounts
    };
}

function calculateGrowth(current, previous) {
    if (previous > 0) {
        return ((current - previous) / previous) * 100;
    }

    return current > 0 ? 100 : 0;
}

function makePdf(report, previousReport, res) {
    const doc = new PDFDocument({
        size: "A4",
        margin: 45
    });

    const chunks = [];

    doc.on("data", chunk => chunks.push(chunk));

    doc.on("end", () => {
        const buffer = Buffer.concat(chunks);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="clean-wave-${report.month}-statement.pdf"`
        );
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "no-store");

        res.send(buffer);
    });

    doc.fontSize(22).fillColor("#082f63")
        .text("CLEAN WAVE", { align: "center" });

    doc.moveDown(0.3);
    doc.fontSize(15).fillColor("#222")
        .text("Monthly Business Statement", { align: "center" });

    doc.moveDown();

    doc.fontSize(10).fillColor("#333");
    doc.text(`Reporting month: ${report.monthLabel}`);
    doc.text(`Reporting period: ${report.startDate} to ${report.endDate} (exclusive)`);
    doc.text("Timezone: Asia/Kolkata");

    doc.moveDown();

    doc.fontSize(13).fillColor("#082f63")
        .text("Financial Summary");

    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#222");

    doc.text(`Sales (excluding cancelled orders): Rs. ${report.sales.toFixed(2)}`);
    doc.text(`Expenses: Rs. ${report.expensesTotal.toFixed(2)}`);
    doc.text(`Estimated profit: Rs. ${report.estimatedProfit.toFixed(2)}`);
    doc.text(`Total orders: ${report.totalOrders}`);
    doc.text(`Orders included in sales: ${report.salesOrderCount}`);

    doc.moveDown();

    doc.fontSize(13).fillColor("#082f63")
        .text("Order Status Summary");

    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#222");

    for (const [status, count] of Object.entries(report.statusCounts)) {
        doc.text(`${status}: ${count}`);
    }

    const growth = calculateGrowth(
        report.sales,
        previousReport.sales
    );

    doc.moveDown();
    doc.fontSize(13).fillColor("#082f63")
        .text("Monthly Sales Growth");

    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#222");

    doc.text(
        `Compared with ${previousReport.monthLabel}: ${growth.toFixed(2)}%`
    );

    doc.text(
        `Previous month sales: Rs. ${previousReport.sales.toFixed(2)}`
    );

    doc.moveDown();

    doc.fontSize(13).fillColor("#082f63")
        .text("Expense Details");

    doc.moveDown(0.5);

    if (!report.expenses.length) {
        doc.fontSize(10).fillColor("#222")
            .text("No expenses recorded for this month.");
    } else {
        for (const expense of report.expenses) {
            doc.fontSize(9).fillColor("#222").text(
                `${expense.expense_date} | ${expense.title} | ` +
                `${expense.category} | Rs. ${Number(expense.amount || 0).toFixed(2)}`
            );
        }
    }

    doc.moveDown();
    doc.fontSize(8).fillColor("#64748b")
        .text(
            "This is an estimated management statement. Profit is calculated as recorded sales minus recorded expenses; it is not a tax or audited financial statement."
        );

    doc.end();
}

async function makeExcel(report, previousReport, res) {
    const workbook = new ExcelJS.Workbook();

    workbook.creator = "CLEAN WAVE";
    workbook.created = new Date();

    const summary = workbook.addWorksheet("Monthly Summary");

    summary.columns = [
        { header: "Particulars", key: "particular", width: 38 },
        { header: "Value", key: "value", width: 24 }
    ];

    const growth = calculateGrowth(
        report.sales,
        previousReport.sales
    );

    summary.addRows([
        { particular: "Business", value: "CLEAN WAVE" },
        { particular: "Reporting Month", value: report.monthLabel },
        { particular: "Period Start", value: report.startDate },
        { particular: "Period End (exclusive)", value: report.endDate },
        { particular: "Timezone", value: "Asia/Kolkata" },
        { particular: "Sales (excluding cancelled orders)", value: report.sales },
        { particular: "Expenses", value: report.expensesTotal },
        { particular: "Estimated Profit", value: report.estimatedProfit },
        { particular: "Total Orders", value: report.totalOrders },
        { particular: "Orders Included in Sales", value: report.salesOrderCount },
        { particular: "Previous Month", value: previousReport.monthLabel },
        { particular: "Previous Month Sales", value: previousReport.sales },
        { particular: "Sales Growth (%)", value: growth }
    ]);

    summary.getRow(1).font = { bold: true };
    summary.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDCEBFA" }
    };

    summary.getColumn(2).numFmt = '#,##0.00';

    const statusSheet = workbook.addWorksheet("Order Status");

    statusSheet.columns = [
        { header: "Order Status", key: "status", width: 25 },
        { header: "Order Count", key: "count", width: 18 }
    ];

    for (const [status, count] of Object.entries(report.statusCounts)) {
        statusSheet.addRow({ status, count });
    }

    statusSheet.getRow(1).font = { bold: true };

    const ordersSheet = workbook.addWorksheet("Orders");

    ordersSheet.columns = [
        { header: "Invoice", key: "invoice", width: 24 },
        { header: "Customer", key: "customer", width: 28 },
        { header: "Status", key: "status", width: 18 },
        { header: "Amount", key: "amount", width: 18 },
        { header: "Created At", key: "createdAt", width: 28 }
    ];

    for (const order of report.orders) {
        ordersSheet.addRow({
            invoice: order.invoice_number || order.id,
            customer: order.customer_name || "",
            status: order.status || "",
            amount: Number(order.total_amount || 0),
            createdAt: order.created_at || ""
        });
    }

    ordersSheet.getRow(1).font = { bold: true };

    const expensesSheet = workbook.addWorksheet("Expenses");

    expensesSheet.columns = [
        { header: "Date", key: "date", width: 16 },
        { header: "Title", key: "title", width: 30 },
        { header: "Category", key: "category", width: 20 },
        { header: "Amount", key: "amount", width: 18 },
        { header: "Payment Method", key: "payment", width: 20 },
        { header: "Reference", key: "reference", width: 24 },
        { header: "Notes", key: "notes", width: 35 }
    ];

    for (const expense of report.expenses) {
        expensesSheet.addRow({
            date: expense.expense_date || "",
            title: expense.title || "",
            category: expense.category || "",
            amount: Number(expense.amount || 0),
            payment: expense.payment_method || "",
            reference: expense.reference_number || "",
            notes: expense.notes || ""
        });
    }

    expensesSheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
        "Content-Disposition",
        `attachment; filename="clean-wave-${report.month}-statement.xlsx"`
    );

    res.setHeader("Cache-Control", "no-store");

    res.send(Buffer.from(buffer));
}

// Activate reporting only after a backup exists.
router.post("/activate", async (req, res) => {
    try {
        const db = req.app.locals.supabase;

        const { data: backup, error: backupError } = await db
            .from("reporting_backups")
            .select("id,created_at,filename")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (backupError) throw backupError;

        if (!backup) {
            return res.status(400).json({
                success: false,
                message: "Download a business backup before activating reporting."
            });
        }

        const { data, error } = await db
            .from("business_reporting_settings")
            .update({
                is_active: true,
                start_date: "2026-11-09",
                timezone: "Asia/Kolkata",
                activated_at: new Date().toISOString()
            })
            .eq("id", 1)
            .select()
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            message: "Reporting period activated from 9 November 2026.",
            reporting: data
        });

    } catch (error) {
        console.error("Reporting activation error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Could not activate reporting."
        });
    }
});

// Download monthly statement.
router.get("/monthly", async (req, res) => {
    try {
        const month = String(req.query.month || "");

        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({
                success: false,
                message: "Select a month using YYYY-MM."
            });
        }

        const db = req.app.locals.supabase;
        const settings = await getReportingSettings(db);

        // Before activation, statements are still available.
        // After activation, November 2026 begins on November 9.
        const reportStartDate = settings.is_active
            ? settings.start_date
            : null;

        const report = await getMonthData(
            db,
            month,
            reportStartDate
        );

        const previousMonthKey = previousMonth(month);

        const previousReport = await getMonthData(
            db,
            previousMonthKey,
            reportStartDate
        );

        const format = String(req.query.format || "pdf").toLowerCase();

        if (format === "pdf") {
            return makePdf(report, previousReport, res);
        }

        if (format === "excel" || format === "xlsx") {
            return await makeExcel(report, previousReport, res);
        }

        return res.status(400).json({
            success: false,
            message: "Format must be pdf or excel."
        });

    } catch (error) {
        console.error("Monthly report error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Could not generate monthly statement."
        });
    }
});

module.exports = router;
