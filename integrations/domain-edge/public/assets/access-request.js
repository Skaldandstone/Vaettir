(() => {
  const triggers = [...document.querySelectorAll("[data-access-request]")];
  if (!triggers.length) return;

  const products = [
    ["", "Choose a product"],
    ["vaettir", "Vaettir"],
    ["vordling", "Vordling"],
    ["wispling", "Wispling"],
  ];
  const dialog = document.createElement("dialog");
  dialog.id = "request-access";
  dialog.className = "access-request-dialog";
  dialog.setAttribute("aria-labelledby", "access-request-title");
  dialog.innerHTML = `
    <div class="access-request-dialog__inner">
      <div class="access-request-dialog__head">
        <div><h2 id="access-request-title">Request an invitation</h2><p>Tell us where you would like to begin. James reviews every request.</p></div>
        <button class="access-request-dialog__close" type="button" aria-label="Close invitation form">×</button>
      </div>
      <form class="access-request-form">
        <label>Your name<input name="name" autocomplete="name" maxlength="100" required></label>
        <label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
        <label>Product<select name="product" required>${products.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <label>What would you like to try? <span>(optional)</span><textarea name="note" maxlength="1500"></textarea></label>
        <label class="access-request-honeypot" aria-hidden="true">Company<input name="company" tabindex="-1" autocomplete="off"></label>
        <p class="access-request-form__privacy">This sends your name, email, product choice, and note to Skald and Stone LLC for invitation review. It is not a newsletter signup. See <a href="https://skaldandstone.com/privacy/">website privacy</a>.</p>
        <button class="access-request-form__submit" type="submit">Send request</button>
        <p class="access-request-form__status" role="status" aria-live="polite"></p>
      </form>
    </div>`;
  document.body.append(dialog);

  const form = dialog.querySelector("form");
  const product = form.elements.product;
  const status = dialog.querySelector(".access-request-form__status");
  const submit = dialog.querySelector(".access-request-form__submit");

  function open(trigger) {
    form.querySelectorAll("input, select, textarea, button[type=submit]").forEach((field) => { field.disabled = false; });
    form.reset();
    status.textContent = "";
    status.removeAttribute("data-state");
    product.value = trigger.dataset.product ?? "";
    dialog.showModal();
    form.elements.name.focus();
  }

  triggers.forEach((trigger) => trigger.addEventListener("click", (event) => {
    event.preventDefault();
    open(trigger);
  }));
  dialog.querySelector(".access-request-dialog__close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Sending…";
    status.removeAttribute("data-state");
    const data = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The request could not be sent.");
      status.textContent = body.duplicate
        ? "You already have a pending request for this product. James will review it."
        : "Request received. James will review it and Clerk will email you if it is approved.";
      form.querySelectorAll("input, select, textarea, button[type=submit]").forEach((field) => { field.disabled = true; });
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error instanceof Error ? error.message : "The request could not be sent.";
      submit.disabled = false;
    }
  });
})();
