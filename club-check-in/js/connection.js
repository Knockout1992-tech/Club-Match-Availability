
/* =========================================================
   CONNECTION STATUS WARNING
   ========================================================= */

(function () {

    function updateConnectionWarning() {

        const warning =
            document.getElementById("connectionWarning");

        if (!warning) {
            return;
        }

        warning.style.display =
            navigator.onLine ? "none" : "block";
    }

    window.addEventListener(
        "online",
        updateConnectionWarning
    );

    window.addEventListener(
        "offline",
        updateConnectionWarning
    );

    updateConnectionWarning();

})();
