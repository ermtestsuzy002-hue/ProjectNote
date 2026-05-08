/* =====================================================================
 *  login.js
 *  ---------------------------------------------------------------------
 *  Controller for /login.html – binds the sign-in & registration forms.
 * ===================================================================== */

(function () {

    /* ----------- helpers ----------- */
    function setBusy(btn, busy) {
        const sp = btn.querySelector(".spinner-border");
        const lb = btn.querySelector(".btn-label");
        if (busy) { sp.classList.remove("d-none"); btn.disabled = true;  if (lb) lb.style.opacity = .6; }
        else      { sp.classList.add("d-none");    btn.disabled = false; if (lb) lb.style.opacity = 1; }
    }
    function showErr(box, msg) {
        if (!msg) { box.classList.add("d-none"); box.textContent = ""; return; }
        box.textContent = msg;
        box.classList.remove("d-none");
    }

    /* ----------- show/hide password ----------- */
    document.querySelectorAll("[data-toggle-pw]").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = btn.parentElement.querySelector("input");
            const ic    = btn.querySelector("i");
            if (input.type === "password") { input.type = "text";  ic.className = "bi bi-eye-slash"; }
            else                            { input.type = "password"; ic.className = "bi bi-eye"; }
        });
    });

    /* ----------- live username availability ----------- */
    const regUsernameInput = document.getElementById("regUsername");
    const usernameStatus   = document.getElementById("usernameStatus");
    const checkUsername    = PN_debounce(async () => {
        const v = String(regUsernameInput.value || "").trim().toLowerCase();
        usernameStatus.innerHTML = '<i class="bi bi-three-dots text-muted"></i>';
        if (!v) return;
        if (!/^[a-z0-9_.-]{3,32}$/.test(v)) {
            usernameStatus.innerHTML = '<i class="bi bi-x-circle text-danger"></i>';
            return;
        }
        try {
            usernameStatus.innerHTML = '<span class="spinner-border spinner-border-sm text-muted"></span>';
            const snap = await PN_DB.collection("usernames").doc(v).get();
            if (snap.exists) {
                usernameStatus.innerHTML = '<i class="bi bi-x-circle-fill text-danger" title="Already taken"></i>';
            } else {
                usernameStatus.innerHTML = '<i class="bi bi-check-circle-fill text-success" title="Available"></i>';
            }
        } catch (e) {
            usernameStatus.innerHTML = '<i class="bi bi-question-circle text-muted"></i>';
        }
    }, 400);
    regUsernameInput.addEventListener("input", checkUsername);


    /* ----------- LOGIN form ----------- */
    const loginForm  = document.getElementById("loginForm");
    const loginErr   = document.getElementById("loginError");
    const loginBtn   = document.getElementById("loginSubmitBtn");
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showErr(loginErr, "");
        setBusy(loginBtn, true);
        const u = document.getElementById("loginUsername").value;
        const p = document.getElementById("loginPassword").value;
        try {
            await PN_login(u, p);
            location.href = "index.html";
        } catch (err) {
            showErr(loginErr, err.message || "Sign-in failed");
        } finally {
            setBusy(loginBtn, false);
        }
    });

    /* ----------- REGISTER form ----------- */
    const regForm   = document.getElementById("registerForm");
    const regErr    = document.getElementById("registerError");
    const regBtn    = document.getElementById("regSubmitBtn");
    regForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showErr(regErr, "");

        const u  = document.getElementById("regUsername").value;
        const p1 = document.getElementById("regPassword").value;
        const p2 = document.getElementById("regPasswordConfirm").value;

        if (p1 !== p2) {
            showErr(regErr, "Passwords do not match");
            return;
        }

        setBusy(regBtn, true);
        try {
            await PN_register(u, p1);
            PN_toast("Account created. Welcome aboard!", "success");
            location.href = "index.html";
        } catch (err) {
            showErr(regErr, err.message || "Registration failed");
        } finally {
            setBusy(regBtn, false);
        }
    });


    /* ----------- Bootstrapping ----------- */
    // 1) Make sure the default owner exists – fire and forget.
    PN_seedDefaultOwner();

    // 2) If a session already exists, bounce straight to the app.
    PN_onAuthReady((user) => {
        if (user) location.href = "index.html";
    });

})();
