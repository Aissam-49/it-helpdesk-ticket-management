// The arrays below hold the current API data in the browser.
let allTickets = [];
let allUsers = [];
let categoryChart;
let departmentChart;

const ticketCategories = ["Network", "Software", "Hardware", "Access"];
const chartColors = ["#4f6bed", "#19a78b", "#f2a93b", "#8b6ee8"];

const ticketForm = document.querySelector("#ticket-form");
const formMessage = document.querySelector("#form-message");
const existingUserFields = document.querySelector("#existing-user-fields");
const newUserFields = document.querySelector("#new-user-fields");
const userSelect = document.querySelector("#user-id");
const tableBody = document.querySelector("#ticket-table-body");
const emptyState = document.querySelector("#empty-state");

// fetchJSON performs the repeated fetch/JSON/error handling for every API call.
async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "The request could not be completed.");
    }
    return data;
}

// Load existing users and put each row into the existing-user dropdown.
async function loadUsers() {
    allUsers = await fetchJSON("/api/users");

    userSelect.innerHTML = '<option value="">Select a user</option>';
    allUsers.forEach((user) => {
        const option = document.createElement("option");
        option.value = user.user_id;
        option.textContent = `${user.full_name} — ${user.department}`;
        userSelect.appendChild(option);
    });
}

// Load summary counts returned by SQL GROUP BY queries.
async function loadSummary() {
    const summary = await fetchJSON("/api/summary");
    const statuses = summary.status_counts;
    const priorities = summary.priority_counts;

    document.querySelector("#open-count").textContent = statuses.Open || 0;
    document.querySelector("#progress-count").textContent = statuses["In Progress"] || 0;
    document.querySelector("#resolved-count").textContent = statuses.Resolved || 0;
    document.querySelector("#high-count").textContent = priorities.High || 0;
    document.querySelector("#resolution-rate").textContent = Number(summary.resolution_rate || 0).toFixed(1);
    renderAnalytics(summary);
}

function renderAnalytics(summary) {
    if (typeof Chart === "undefined") return;

    const categoryCounts = summary.category_counts || {};
    const departmentCounts = summary.department_counts || {};
    const categoryData = {
        labels: ticketCategories,
        datasets: [{
            data: ticketCategories.map((category) => categoryCounts[category] || 0),
            backgroundColor: chartColors,
            borderColor: "#ffffff",
            borderWidth: 4,
            hoverOffset: 6,
        }],
    };
    const departmentLabels = Object.keys(departmentCounts);
    const departmentData = {
        labels: departmentLabels,
        datasets: [{
            label: "Tickets",
            data: departmentLabels.map((department) => departmentCounts[department]),
            backgroundColor: "#4f6bed",
            borderRadius: 5,
            maxBarThickness: 26,
        }],
    };

    if (categoryChart) {
        categoryChart.data = categoryData;
        categoryChart.update();
    } else {
        categoryChart = new Chart(document.querySelector("#category-chart"), {
            type: "doughnut",
            data: categoryData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "68%",
                plugins: { legend: { position: "bottom", labels: { usePointStyle: true, padding: 18 } } },
            },
        });
    }

    if (departmentChart) {
        departmentChart.data = departmentData;
        departmentChart.update();
    } else {
        departmentChart = new Chart(document.querySelector("#department-chart"), {
            type: "bar",
            data: departmentData,
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#edf0f5" } },
                    y: { grid: { display: false } },
                },
            },
        });
    }
}

// Load the INNER JOIN result and send the array through the active filters.
async function loadTickets() {
    allTickets = await fetchJSON("/api/tickets");
    renderTickets();
}

// Convert a database timestamp into a short, readable date for the table.
function formatDate(timestamp) {
    if (!timestamp) return "—";
    const date = new Date(timestamp.includes("T") ? timestamp : `${timestamp.replace(" ", "T")}Z`);
    return Number.isNaN(date.getTime())
        ? timestamp
        : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function statusClass(status) {
    return status.toLowerCase().replaceAll(" ", "-");
}

// Render only rows matching the active queue filters.
function renderTickets() {
    const statusFilter = document.querySelector("#status-filter").value;
    const priorityFilter = document.querySelector("#priority-filter").value;
    const categoryFilter = document.querySelector("#category-filter").value;
    const searchTerm = document.querySelector("#search-filter").value.trim().toLowerCase();

    const visibleTickets = allTickets.filter((ticket) => {
        const statusMatches = statusFilter === "All" || ticket.status === statusFilter;
        const priorityMatches = priorityFilter === "All" || ticket.priority === priorityFilter;
        const categoryMatches = categoryFilter === "All" || ticket.category === categoryFilter;
        const searchableText = [
            ticket.ticket_id,
            ticket.title,
            ticket.full_name,
            ticket.department,
        ].join(" ").toLowerCase();
        const searchMatches = !searchTerm || searchableText.includes(searchTerm);
        return statusMatches && priorityMatches && categoryMatches && searchMatches;
    });

    tableBody.innerHTML = "";

    visibleTickets.forEach((ticket) => {
        const nextStatus = ticket.status === "Open"
            ? "In Progress"
            : ticket.status === "In Progress"
                ? "Resolved"
                : null;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>#${ticket.ticket_id}</td>
            <td class="requester">
                <strong>${escapeHTML(ticket.full_name)}</strong>
                <span>${escapeHTML(ticket.department)}</span>
            </td>
            <td class="issue-cell" title="${escapeHTML(ticket.title)}">${escapeHTML(ticket.title)}</td>
            <td>${escapeHTML(ticket.category)}</td>
            <td><span class="badge priority-${ticket.priority.toLowerCase()}">${escapeHTML(ticket.priority)}</span></td>
            <td><span class="badge status-${statusClass(ticket.status)}">${escapeHTML(ticket.status)}</span></td>
            <td>${formatDate(ticket.created_at)}</td>
            <td>
                ${nextStatus
                    ? `<button class="action-button status-action" data-id="${ticket.ticket_id}" data-status="${nextStatus}">Set ${escapeHTML(nextStatus)}</button>`
                    : '<button class="action-button" disabled>Completed</button>'}
                <button class="action-button delete delete-action" data-id="${ticket.ticket_id}">Delete</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    emptyState.hidden = visibleTickets.length !== 0;
}

// Escape text before placing API values into innerHTML.
function escapeHTML(value) {
    const element = document.createElement("span");
    element.textContent = value == null ? "" : String(value);
    return element.innerHTML;
}

// Show or hide the new-user fields based on the requester radio choice.
function updateUserMode() {
    const mode = document.querySelector('input[name="user_mode"]:checked').value;
    const isNewUser = mode === "new";

    existingUserFields.hidden = isNewUser;
    newUserFields.hidden = !isNewUser;
    userSelect.disabled = isNewUser;

    newUserFields.querySelectorAll("input").forEach((input) => {
        input.required = isNewUser;
    });
}

// Basic browser validation before a create-ticket API call is made.
function validateTicketForm(formData) {
    if (!formData.get("title")?.trim()) return "Enter a ticket title.";
    if (!formData.get("category")) return "Select a category.";
    if (!formData.get("priority")) return "Select a priority.";

    if (formData.get("user_mode") === "existing" && !formData.get("user_id")) {
        return "Select an existing user or add a new one.";
    }

    if (formData.get("user_mode") === "new") {
        if (!formData.get("full_name")?.trim()) return "Enter the new user's full name.";
        if (!formData.get("department")?.trim()) return "Enter the new user's department.";

        const email = formData.get("email")?.trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return "Enter a valid email address.";
        }
    }
    return "";
}

// Submit the form and refresh ticket data and summary counts after success.
function submitTicket(event) {
    event.preventDefault();

    const submitButton = ticketForm.querySelector('button[type="submit"]');
    const formData = new FormData(ticketForm);
    const payload = Object.fromEntries(formData.entries());

    const validationError = validateTicketForm(formData);
    if (validationError) {
        formMessage.textContent = validationError;
        formMessage.className = "form-message error";
        return;
    }

    submitButton.disabled = true;
    formMessage.textContent = "";

    fetchJSON("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })
        .then(async () => {
            ticketForm.reset();
            document.querySelector('input[name="user_mode"][value="existing"]').checked = true;
            updateUserMode();
            formMessage.textContent = "Ticket created successfully.";
            formMessage.className = "form-message success";
            showToast("Ticket created successfully.");
            await Promise.all([loadTickets(), loadSummary(), loadUsers()]);
        })
        .catch((error) => {
            formMessage.textContent = error.message;
            formMessage.className = "form-message error";
        })
        .finally(() => {
            submitButton.disabled = false;
        });
}

ticketForm.addEventListener("submit", submitTicket);

document.querySelectorAll('input[name="user_mode"]').forEach((radio) => {
    radio.addEventListener("change", updateUserMode);
});

document.querySelector("#status-filter").addEventListener("change", renderTickets);
document.querySelector("#priority-filter").addEventListener("change", renderTickets);
document.querySelector("#category-filter").addEventListener("change", renderTickets);
document.querySelector("#search-filter").addEventListener("input", renderTickets);

const navigationLinks = document.querySelectorAll(".nav-link");
function setActiveNavigation(hash) {
    navigationLinks.forEach((link) => {
        const isActive = link.getAttribute("href") === hash;
        link.classList.toggle("active", isActive);
        if (isActive) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
    });
}

navigationLinks.forEach((link) => {
    link.addEventListener("click", () => setActiveNavigation(link.getAttribute("href")));
});

if ("IntersectionObserver" in window) {
    const navigationObserver = new IntersectionObserver((entries) => {
        const visibleTarget = entries
            .filter((entry) => entry.isIntersecting)
            .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0];
        if (visibleTarget) setActiveNavigation(`#${visibleTarget.target.id}`);
    }, { rootMargin: "-88px 0px -68% 0px", threshold: 0 });

    ["overview", "analytics", "new-ticket", "support-queue"].forEach((id) => {
        navigationObserver.observe(document.querySelector(`#${id}`));
    });
}

document.querySelector(".log-ticket-button").addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelector("#new-ticket").scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#title").focus({ preventScroll: true });
    setActiveNavigation("#new-ticket");
});

// Delegate table actions so buttons created dynamically still receive clicks.
tableBody.addEventListener("click", async (event) => {
    const statusButton = event.target.closest(".status-action");
    const deleteButton = event.target.closest(".delete-action");

    if (statusButton) {
        statusButton.disabled = true;
        try {
            await fetchJSON(`/api/tickets/${statusButton.dataset.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: statusButton.dataset.status }),
            });
            showToast(`Ticket moved to ${statusButton.dataset.status}.`);
            await Promise.all([loadTickets(), loadSummary()]);
        } catch (error) {
            showToast(error.message);
            statusButton.disabled = false;
        }
    }

    if (deleteButton) {
        const ticketId = deleteButton.dataset.id;
        if (!window.confirm(`Delete ticket #${ticketId}?`)) return;

        try {
            await fetchJSON(`/api/tickets/${ticketId}`, { method: "DELETE" });
            showToast(`Ticket #${ticketId} deleted.`);
            await Promise.all([loadTickets(), loadSummary()]);
        } catch (error) {
            showToast(error.message);
        }
    }
});

let toastTimer;
function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

// Start the page by loading users, tickets, and summary counts in parallel.
async function initializePage() {
    updateUserMode();
    try {
        await Promise.all([loadUsers(), loadTickets(), loadSummary()]);
    } catch (error) {
        showToast(error.message);
    }
}

initializePage();
