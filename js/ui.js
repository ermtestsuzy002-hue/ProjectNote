/* =====================================================================
 *  ui.js
 *  ---------------------------------------------------------------------
 *  Reusable UI primitives:
 *    – toast notifications
 *    – confirm() modal
 *    – global loading spinner
 *    – dark / light theme toggle
 *    – generic Bootstrap modal opener / closer
 * ===================================================================== */

(function () {

    /* ============================================================
     * Toast notifications
     * ============================================================ */
    function ensureToastContainer() {
        let c = document.getElementById("pn-toast-container");
        if (!c) {
            c = document.createElement("div");
            c.id = "pn-toast-container";
            c.className = "toast-container position-fixed top-0 end-0 p-3";
            c.style.zIndex = 1090;
            document.body.appendChild(c);
        }
        return c;
    }

    /**
     * Show a toast notification.
     * @param {string} msg
     * @param {"success"|"error"|"info"|"warning"} type
     * @param {number} delay
     */
    window.PN_toast = function (msg, type, delay) {
        const c = ensureToastContainer();
        type  = type  || "info";
        delay = delay || 3500;

        const palette = {
            success: { bg: "text-bg-success", icon: "bi-check-circle-fill" },
            error:   { bg: "text-bg-danger",  icon: "bi-x-octagon-fill"    },
            warning: { bg: "text-bg-warning", icon: "bi-exclamation-triangle-fill" },
            info:    { bg: "text-bg-primary", icon: "bi-info-circle-fill"  }
        }[type] || { bg: "text-bg-secondary", icon: "bi-bell-fill" };

        const el = document.createElement("div");
        el.className = `toast align-items-center border-0 ${palette.bg} shadow-lg`;
        el.setAttribute("role", "alert");
        el.innerHTML = `
            <div class="d-flex">
              <div class="toast-body d-flex align-items-center gap-2">
                <i class="bi ${palette.icon}"></i>
                <span>${PN_escapeHtml(msg)}</span>
              </div>
              <button type="button" class="btn-close btn-close-white me-2 m-auto"
                      data-bs-dismiss="toast" aria-label="Close"></button>
            </div>`;
        c.appendChild(el);
        const t = new bootstrap.Toast(el, { delay });
        t.show();
        el.addEventListener("hidden.bs.toast", () => el.remove());
    };


    /* ============================================================
     * Global loading spinner (full screen)
     * ============================================================ */
    function ensureSpinnerEl() {
        let s = document.getElementById("pn-global-spinner");
        if (!s) {
            s = document.createElement("div");
            s.id = "pn-global-spinner";
            s.className = "pn-spinner-overlay d-none";
            s.innerHTML = `
                <div class="pn-spinner-inner">
                    <div class="spinner-border text-light" role="status"></div>
                    <div class="pn-spinner-label mt-3">Loading...</div>
                </div>`;
            document.body.appendChild(s);
        }
        return s;
    }
    window.PN_showSpinner = function (label) {
        const s = ensureSpinnerEl();
        s.querySelector(".pn-spinner-label").textContent = label || "Loading...";
        s.classList.remove("d-none");
    };
    window.PN_hideSpinner = function () {
        const s = ensureSpinnerEl();
        s.classList.add("d-none");
    };


    /* ============================================================
     * Confirm() modal (Promise based – returns true / false)
     * ============================================================ */
    window.PN_confirm = function (opts) {
        opts = Object.assign({
            title:   "Are you sure?",
            message: "",
            okText:  "Confirm",
            cancelText: "Cancel",
            danger:  false
        }, opts || {});

        return new Promise((resolve) => {
            // Build DOM
            const wrap = document.createElement("div");
            wrap.className = "modal fade";
            wrap.tabIndex  = -1;
            wrap.innerHTML = `
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                  <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="bi ${opts.danger ? "bi-exclamation-triangle-fill text-danger" : "bi-question-circle-fill text-primary"} me-2"></i>
                        ${PN_escapeHtml(opts.title)}
                    </h5>
                    <button class="btn-close" data-bs-dismiss="modal"></button>
                  </div>
                  <div class="modal-body">${PN_escapeHtml(opts.message)}</div>
                  <div class="modal-footer">
                    <button class="btn btn-outline-secondary" data-bs-dismiss="modal" data-pn-result="0">
                        ${PN_escapeHtml(opts.cancelText)}
                    </button>
                    <button class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" data-pn-result="1">
                        ${PN_escapeHtml(opts.okText)}
                    </button>
                  </div>
                </div>
              </div>`;
            document.body.appendChild(wrap);
            const modal = new bootstrap.Modal(wrap);

            let answered = false;
            wrap.querySelectorAll("[data-pn-result]").forEach(btn => {
                btn.addEventListener("click", () => {
                    answered = true;
                    resolve(btn.dataset.pnResult === "1");
                    modal.hide();
                });
            });
            wrap.addEventListener("hidden.bs.modal", () => {
                if (!answered) resolve(false);
                wrap.remove();
            });
            modal.show();
        });
    };


    /* ============================================================
     * Dark / Light theme
     * ============================================================ */
    window.PN_applyTheme = function (theme) {
        document.documentElement.setAttribute("data-bs-theme", theme);
        document.documentElement.setAttribute("data-pn-theme", theme);
        try { localStorage.setItem("pn_theme", theme); } catch (e) {}
        // Update icon if button exists
        const btn = document.getElementById("themeToggleBtn");
        if (btn) {
            btn.querySelector("i").className =
                "bi " + (theme === "dark" ? "bi-sun-fill" : "bi-moon-stars-fill");
        }
    };

    window.PN_toggleTheme = function () {
        const cur = document.documentElement.getAttribute("data-bs-theme") || "light";
        PN_applyTheme(cur === "light" ? "dark" : "light");
    };

    // Initialise theme on every page load.
    (function initTheme() {
        let theme = "light";
        try { theme = localStorage.getItem("pn_theme") || "light"; } catch (e) {}
        PN_applyTheme(theme);
    })();


    /* ============================================================
     * Empty-state helper – returns HTML for an empty list
     * ============================================================ */
    window.PN_emptyState = function (icon, title, subtitle) {
        return `
            <div class="pn-empty">
                <i class="bi ${icon || "bi-inbox"}"></i>
                <h5>${PN_escapeHtml(title || "Nothing here yet")}</h5>
                <p class="text-muted">${PN_escapeHtml(subtitle || "")}</p>
            </div>`;
    };

})();
