
// Render Shell ====================================

function renderShell(
    content,
    showHome = true
) {

    document.getElementById(
        "app"
    ).innerHTML = `

        <div class="app-header">

            <div class="brand">

                <img
                    src="RHRFC.jpg"
                    alt="RHRFC">

                <div>

                    <div class="brand-title">
                        CLUB CHECK-IN
                    </div>

                    <div class="brand-season">
                        Season ${currentSeason}
                    </div>

                </div>

            </div>

            ${
                showHome
                ? `

                    <div class="header-actions">

                        <button
                            class="header-button"
                            onclick="goHome()">

                            Home

                        </button>

                        <button
                            class="header-button"
                            onclick="logout()">

                            Logout

                        </button>

                    </div>

                `
                : ""
            }

        </div>

        <main class="page">

            ${content}

        </main>

        <footer class="app-policy-footer">
            <a href="https://rhrufc-mini.pages.dev/policies/">Privacy &amp; Data Protection</a>
        </footer>

    `;

}
