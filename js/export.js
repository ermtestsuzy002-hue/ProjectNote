/* =====================================================================
 *  export.js
 *  ---------------------------------------------------------------------
 *  Export notes to CSV, JSON or PDF.
 *
 *  Public API:
 *    PN_exportProject(project, groups, notes, format)
 *
 *  Format must be one of: "csv" | "json" | "pdf"
 * ===================================================================== */

(function () {

    window.PN_exportProject = function (project, groups, notes, format) {
        if (!project) return;
        format = (format || "csv").toLowerCase();
        const safeName = (project.name || "project").replace(/[^\w.\-]+/g, "_").substring(0, 40);

        if (format === "csv")  return _exportCsv (project, groups, notes, safeName);
        if (format === "json") return _exportJson(project, groups, notes, safeName);
        if (format === "pdf")  return _exportPdf (project, groups, notes, safeName);
        throw new Error("Unknown format: " + format);
    };

    /* ============================================================
     * CSV
     * ============================================================ */
    function _exportCsv(project, groups, notes, safeName) {
        const groupsById = {};
        groups.forEach(g => groupsById[g.id] = g);

        const headers = [
            "Group", "Title", "Description", "Status", "Assignee",
            "Tags", "Link", "Due Date", "Attachment Count",
            "Created At", "Updated At"
        ];
        const rows = [headers];
        notes.forEach(n => {
            const g = groupsById[n.groupId];
            rows.push([
                g ? g.title : "",
                n.title || "",
                n.description || "",
                PN_STATUS_LABELS[n.status] || n.status || "",
                n.assignee || "",
                (n.tags || []).join("; "),
                n.link || "",
                n.dueAt ? PN_fmtDate(n.dueAt) : "",
                (n.attachments || []).length,
                n.createdAt ? PN_fmtDate(n.createdAt) : "",
                n.updatedAt ? PN_fmtDate(n.updatedAt) : ""
            ]);
        });

        const csv = rows.map(r => r.map(_csvCell).join(",")).join("\r\n");
        // BOM so Excel correctly displays UTF-8.
        PN_downloadBlob("\ufeff" + csv, `${safeName}.csv`, "text/csv;charset=utf-8");
    }

    function _csvCell(v) {
        const s = (v === null || v === undefined) ? "" : String(v);
        if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }

    /* ============================================================
     * JSON
     * ============================================================ */
    function _exportJson(project, groups, notes, safeName) {
        const data = {
            exportedAt: new Date().toISOString(),
            project: {
                id:          project.id,
                name:        project.name,
                description: project.description,
                visibility:  project.visibility,
                ownerUsername: project.ownerUsername,
                createdAt:   project.createdAt ? PN_fmtDate(project.createdAt) : null,
                updatedAt:   project.updatedAt ? PN_fmtDate(project.updatedAt) : null
            },
            groups: groups.map(g => ({
                id: g.id, title: g.title, color: g.color, order: g.order
            })),
            notes: notes.map(n => ({
                id:          n.id,
                groupId:     n.groupId,
                title:       n.title,
                description: n.description,
                status:      n.status,
                assignee:    n.assignee || "",
                tags:        n.tags || [],
                link:        n.link || "",
                dueAt:       n.dueAt || null,
                attachments: (n.attachments || []).map(a => ({
                    name: a.name, type: a.type, url: a.url, size: a.size
                })),
                createdAt:   n.createdAt ? PN_fmtDate(n.createdAt) : null,
                updatedAt:   n.updatedAt ? PN_fmtDate(n.updatedAt) : null
            }))
        };
        PN_downloadBlob(JSON.stringify(data, null, 2),
                        `${safeName}.json`,
                        "application/json;charset=utf-8");
    }

    /* ============================================================
     * PDF (jsPDF must be loaded globally)
     * ============================================================ */
    function _exportPdf(project, groups, notes, safeName) {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            PN_toast("PDF library not loaded.", "error");
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "pt", format: "a4" });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const M     = 40;            // margin
        let y       = M;

        const ensure = (need) => {
            if (y + need > pageH - M) { doc.addPage(); y = M; }
        };

        // Header
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.text(project.name || "Project", M, y);
        y += 24;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(110);
        const subtitle = `Exported on ${PN_fmtDate(new Date())} • ` +
                         `${notes.length} note(s) across ${groups.length} group(s)`;
        doc.text(subtitle, M, y);
        y += 18;

        if (project.description) {
            doc.setTextColor(60);
            const lines = doc.splitTextToSize(project.description, pageW - 2 * M);
            doc.text(lines, M, y);
            y += lines.length * 12 + 12;
        }

        // Group sections
        const groupsById = {};
        groups.forEach(g => groupsById[g.id] = g);

        const orderedGroups = groups.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

        orderedGroups.forEach(g => {
            const gNotes = notes.filter(n => n.groupId === g.id);

            ensure(40);
            // Group divider
            doc.setDrawColor(220);
            doc.line(M, y, pageW - M, y);
            y += 16;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            doc.setTextColor(30);
            doc.text(`${g.title}  (${gNotes.length})`, M, y);
            y += 18;

            if (!gNotes.length) {
                doc.setFont("helvetica", "italic");
                doc.setFontSize(10);
                doc.setTextColor(140);
                doc.text("No notes.", M, y);
                y += 16;
                return;
            }

            gNotes.forEach((n, idx) => {
                ensure(60);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(11);
                doc.setTextColor(20);
                doc.text(`${idx + 1}. ${n.title}`, M, y);
                y += 14;

                doc.setFont("helvetica", "normal");
                doc.setFontSize(9);
                doc.setTextColor(110);
                const meta = [
                    PN_STATUS_LABELS[n.status] || n.status || "",
                    n.assignee ? "Assignee: " + n.assignee : "",
                    n.dueAt    ? "Due: " + PN_fmtDate(n.dueAt) : "",
                    (n.tags && n.tags.length) ? "Tags: " + n.tags.join(", ") : ""
                ].filter(Boolean).join("   |   ");
                if (meta) {
                    doc.text(meta, M, y);
                    y += 12;
                }

                if (n.description) {
                    doc.setTextColor(50);
                    doc.setFontSize(10);
                    const lines = doc.splitTextToSize(n.description, pageW - 2 * M);
                    lines.forEach(line => {
                        ensure(14);
                        doc.text(line, M, y);
                        y += 12;
                    });
                }

                if (n.attachments && n.attachments.length) {
                    ensure(14);
                    doc.setFont("helvetica", "italic");
                    doc.setFontSize(9);
                    doc.setTextColor(120);
                    doc.text(`📎 ${n.attachments.length} attachment(s)`, M, y);
                    y += 12;
                }

                y += 8;
            });
        });

        // Footer page numbers
        const total = doc.internal.getNumberOfPages();
        for (let i = 1; i <= total; i++) {
            doc.setPage(i);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`Page ${i} of ${total}`, pageW - M, pageH - 16, { align: "right" });
            doc.text("Project Note · " + (project.name || ""), M, pageH - 16);
        }

        doc.save(`${safeName}.pdf`);
    }

})();
