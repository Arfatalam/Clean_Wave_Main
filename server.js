"use strict";

const app = require("./server/server");

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log("------------------------------------");
        console.log("CLEAN WAVE backend started");
        console.log(`Website: http://localhost:${PORT}`);
        console.log(`Health: http://localhost:${PORT}/api/health`);
        console.log(`Admin: http://localhost:${PORT}/admin.html`);
        console.log("------------------------------------");
    });
}
