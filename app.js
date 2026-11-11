
const SUPABASE_URL = "https://muxxlewtqhpckhoqeinn.supabase.co";

const GET_FIXTURE_URL = `${SUPABASE_URL}/functions/v1/get_fixture`;
const SUBMIT_URL = `${SUPABASE_URL}/functions/v1/submit_availability`;

const params = new URLSearchParams(window.location.search);
const fixtureToken = params.get("fixture");

const loading = document.getElementById("loading");
const fixtureSection = document.getElementById("fixture");
const availabilityForm = document.getElementById("availability-form");
const message = document.getElementById("message");
const childrenContainer = document.getElementById("children");
const submissionForm = document.getElementById("submission-form");

let fixtureAgeGroups = [];

function showMessage(text, isError = false) {
    loading.hidden = true;
    fixtureSection.hidden = true;
    availabilityForm.hidden = true;
    message.hidden = false;
    message.textContent = text;
    message.className = isError ? "panel error-message" : "panel";
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function formatDate(dateString) {
    const date = new Date(`${dateString.substring(0, 10)}T12:00:00`);

    return date.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });
}

async function loadFixture() {
    if (!fixtureToken) {
        showMessage(
            "This link is missing its fixture reference. Please use the link shared by your coach.",
            true
        );
        return;
    }

    try {
        const response = await fetch(GET_FIXTURE_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ token: fixtureToken })
        });

        const result = await response.json();

        if (!response.ok) {
            showMessage(result.error || "Unable to load this fixture.", true);
            return;
        }

        fixtureAgeGroups = result.age_groups || [];
        displayFixture(result);

    } catch (error) {
        console.error("Fixture loading failed:", error);
        showMessage(
            "Unable to connect. Please check your internet connection and try again.",
            true
        );
    }
}

function displayFixture(data) {
    const fixture = data.fixture;

    document.getElementById("opposition").textContent =
        fixture.opposition;

    const fixtureType =
        fixture.fixture_type === "home" ? "Home fixture" : "Away fixture";

    let details = `
        <p><strong>${formatDate(fixture.fixture_date)}</strong></p>
        <p>${fixtureType}</p>
    `;

    if (fixture.kick_off_time) {
        details += `<p>Kick-off: ${escapeHTML(fixture.kick_off_time.substring(0, 5))}</p>`;
    }

    if (fixture.venue) {
        details += `<p>Venue: ${escapeHTML(fixture.venue)}</p>`;
    }

    if (fixture.venue_address) {
        details += `<p>${escapeHTML(fixture.venue_address)}</p>`;
    }

    if (fixture.response_deadline) {
        details += `<p>Responses requested by: ${formatDate(fixture.response_deadline)}</p>`;
    }

    document.getElementById("fixture-details").innerHTML = details;

    loading.hidden = true;
    fixtureSection.hidden = false;
    availabilityForm.hidden = false;

    addChild();
}

function addChild() {
    const currentCards = childrenContainer.querySelectorAll(".child-card");

    if (currentCards.length >= 20) {
        alert("You can add a maximum of 20 children.");
        return;
    }

    if (fixtureAgeGroups.length === 0) {
        showMessage("There are no age groups available for this fixture.", true);
        return;
    }

    const ageGroupOptions = fixtureAgeGroups.map(group => `
        <option value="${Number(group.id)}">
            ${escapeHTML(group.display_name || group.age_group)}
        </option>
    `).join("");

    const card = document.createElement("div");
    card.className = "child-card";

    card.innerHTML = `
        <h3>Child ${currentCards.length + 1}</h3>

        <div class="form-group">
            <label>Child's full name</label>
            <input type="text" class="child-name" maxlength="100" required>
        </div>

        <div class="form-group">
            <label>Age group</label>
            <select class="child-age-group" required>
                <option value="">Select age group</option>
                ${ageGroupOptions}
            </select>
        </div>

        <div class="form-group">
            <label>School year</label>
            <input type="text" class="child-school-year"
                   maxlength="30" placeholder="e.g. Year 2" required>
        </div>

        <div class="form-group">
            <label>Availability</label>
            <select class="child-availability" required>
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
                <option value="unsure">Unsure</option>
            </select>
        </div>

        <button type="button" class="remove-child">
            Remove child
        </button>
    `;

    card.querySelector(".remove-child").addEventListener("click", () => {
        card.remove();
        renumberChildren();
    });

    childrenContainer.appendChild(card);
}

function renumberChildren() {
    const cards = childrenContainer.querySelectorAll(".child-card");

    cards.forEach((card, index) => {
        card.querySelector("h3").textContent = `Child ${index + 1}`;
    });
}

document.getElementById("add-child").addEventListener("click", addChild);

submissionForm.addEventListener("submit", async event => {
    event.preventDefault();

    const cards = [...childrenContainer.querySelectorAll(".child-card")];

    if (cards.length === 0) {
        alert("Please add at least one child.");
        return;
    }

    const parentName = document.getElementById("parent-name").value.trim();
    const parentContact = document.getElementById("parent-contact").value.trim();

    if (!parentName || !parentContact) {
        alert("Please enter your name and contact details.");
        return;
    }

    const children = cards.map(card => ({
        child_name: card.querySelector(".child-name").value.trim(),
        age_group_id: Number(card.querySelector(".child-age-group").value),
        school_year: card.querySelector(".child-school-year").value.trim(),
        availability: card.querySelector(".child-availability").value
    }));

    if (children.some(child =>
        !child.child_name ||
        !child.age_group_id ||
        !child.school_year
    )) {
        alert("Please complete all the details for each child.");
        return;
    }

    const submitButton = document.getElementById("submit-button");
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    try {
        const response = await fetch(SUBMIT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                fixture_token: fixtureToken,
                parent_name: parentName,
                parent_contact: parentContact,
                children
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || "Unable to submit availability.");
        }

        const editUrl = new URL(window.location.href);
        editUrl.searchParams.delete("fixture");
        editUrl.searchParams.set("edit", result.edit_token);

        loading.hidden = true;
        fixtureSection.hidden = true;
        availabilityForm.hidden = true;
        message.hidden = false;

        message.innerHTML = `
            <h2 class="success-message">Availability submitted!</h2>
            <p>Thank you. Your response has been recorded.</p>
            <p>You can use the private link below to amend your response later. Please keep it safe.</p>
            <a class="edit-link" href="${escapeHTML(editUrl.href)}">
                ${escapeHTML(editUrl.href)}
            </a>
            <button type="button" id="copy-edit-link">
                Copy my edit link
            </button>
        `;

        document.getElementById("copy-edit-link").addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(editUrl.href);
                document.getElementById("copy-edit-link").textContent = "Link copied!";
            } catch {
                document.getElementById("copy-edit-link").textContent =
                    "Please copy the link above.";
            }
        });

    } catch (error) {
        console.error("Submission failed:", error);
        alert(error.message || "Unable to submit your response. Please try again.");

        submitButton.disabled = false;
        submitButton.textContent = "Submit availability";
    }
});

loadFixture();
