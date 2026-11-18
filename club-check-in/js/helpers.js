// Escape HTML =====================================

function escapeHTML(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

// dialog box ================================
function showClubDialog({
    title,
    message,
    type = "warning",
    confirmText = "OK",
    cancelText = "Cancel",
    requireConfirmation = false
}) {
    return new Promise(resolve => {
        const icons = {
            warning: "⚠️",
            danger: "⛔",
            success: "✓",
            info: "ℹ️"
        };

        const overlay = document.createElement("div");
        overlay.className = "cc-dialog-overlay";

        const dialog = document.createElement("div");
        dialog.className = "cc-dialog";
        dialog.setAttribute(
            "role",
            requireConfirmation ? "alertdialog" : "alertdialog"
        );
        dialog.setAttribute("aria-modal", "true");

        const icon = document.createElement("div");
        icon.className = "cc-dialog-icon cc-dialog-" + type;
        icon.textContent = icons[type] || icons.warning;

        const heading = document.createElement("h2");
        heading.textContent = title;

        const body = document.createElement("div");
        body.className = "cc-dialog-message";
        body.textContent = message;

        const actions = document.createElement("div");
        actions.className = "cc-dialog-actions";

        function close(result) {
            document.removeEventListener("keydown", onKeyDown);
            overlay.remove();
            resolve(result);
        }

        function onKeyDown(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                close(false);
            }
        }

        if (requireConfirmation) {
            const cancel = document.createElement("button");
            cancel.className = "cc-dialog-cancel";
            cancel.textContent = cancelText;
            cancel.addEventListener("click", () => close(false));
            actions.appendChild(cancel);
        }

        const confirm = document.createElement("button");
        confirm.className = requireConfirmation
            ? "cc-dialog-confirm"
            : "cc-dialog-ok";
        confirm.textContent = confirmText;
        confirm.addEventListener("click", () => close(true));
        actions.appendChild(confirm);

        dialog.append(icon, heading, body, actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        document.addEventListener("keydown", onKeyDown);

        confirm.focus();
    });
}

function appAlert(message, title = "Club Check-In", type = "warning") {
    return showClubDialog({
        title,
        message,
        type
    });
}

function appConfirm(message, title = "Please confirm", confirmText = "Confirm") {
    return showClubDialog({
        title,
        message,
        type: "danger",
        confirmText,
        cancelText: "Cancel",
        requireConfirmation: true
    });
}
