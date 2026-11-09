
"use strict";

const TIMEZONE = "Asia/Kolkata";
const REPORTING_START_DATE = "2026-11-09";
const INDIA_OFFSET = "+05:30";

function getISTDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day)
    };
}

function formatMonth(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

function getMonthRange(monthValue, reportingStartDate) {
    if (!/^\d{4}-\d{2}$/.test(monthValue)) {
        throw new Error("Month must use YYYY-MM format.");
    }

    const [year, month] = monthValue.split("-").map(Number);

    if (month < 1 || month > 12) {
        throw new Error("Invalid reporting month.");
    }

    const firstDay = `${monthValue}-01`;

    const nextMonthDate = new Date(Date.UTC(year, month, 1));
    const nextMonth = formatMonth(
        nextMonthDate.getUTCFullYear(),
        nextMonthDate.getUTCMonth() + 1
    );

    const startDate =
        reportingStartDate &&
        reportingStartDate.slice(0, 7) === monthValue &&
        reportingStartDate > firstDay
            ? reportingStartDate
            : firstDay;

    return {
        month: monthValue,
        startDate,
        endDateExclusive: `${nextMonth}-01`,
        startTimestamp: new Date(
            `${startDate}T00:00:00${INDIA_OFFSET}`
        ).toISOString(),
        endTimestamp: new Date(
            `${nextMonth}-01T00:00:00${INDIA_OFFSET}`
        ).toISOString()
    };
}

function previousMonth(monthValue) {
    const [year, month] = monthValue.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 2, 1));

    return formatMonth(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1
    );
}

function formatMonthLabel(monthValue) {
    const [year, month] = monthValue.split("-").map(Number);

    return new Intl.DateTimeFormat("en-IN", {
        month: "long",
        year: "numeric",
        timeZone: TIMEZONE
    }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

async function getReportingSettings(db) {
    const { data, error } = await db
        .from("business_reporting_settings")
        .select("is_active,start_date,timezone,activated_at")
        .eq("id", 1)
        .maybeSingle();

    if (error) throw error;

    return data || {
        is_active: false,
        start_date: REPORTING_START_DATE,
        timezone: TIMEZONE,
        activated_at: null
    };
}

async function getAllRows(db, table, columns = "*") {
    const allRows = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await db
            .from(table)
            .select(columns)
            .range(offset, offset + pageSize - 1);

        if (error) {
            throw new Error(
                `Could not read ${table}: ${error.message}`
            );
        }

        const rows = data || [];
        allRows.push(...rows);

        if (rows.length < pageSize) break;

        offset += pageSize;
    }

    return allRows;
}

module.exports = {
    TIMEZONE,
    REPORTING_START_DATE,
    getISTDateParts,
    getMonthRange,
    previousMonth,
    formatMonthLabel,
    getReportingSettings,
    getAllRows
};
