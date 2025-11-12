/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

// System prompt: only answer questions related to L'Oréal products, routines and recommendations.
// Politely refuse unrelated requests and invite the user to ask about L'Oréal or beauty topics.
const systemPrompt = `You are a helpful assistant specialized in L'Oréal products, skincare and haircare routines, and product recommendations from L'Oréal brands. 
Only answer questions that are directly related to L'Oréal products, routines, recommendations, or general beauty-related topics. 
If the user asks about anything unrelated (for example politics, personal medical diagnoses, illegal activity, or topics outside L'Oréal/beauty), politely refuse and say you can only help with L'Oréal product and beauty questions. 
Be brief, friendly, and ask clarifying questions when needed.`;

const WORKER_URL = "https://gca-loreal-worker.nhoekstr.workers.dev/";

function addMessage(sender, text) {
  const str = String(text ?? "");
  const escaped = str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const senderClass = String(sender).toLowerCase();

  const el = document.createElement("div");
  el.className = `message ${senderClass}`;
  el.innerHTML = `<strong>${sender}:</strong> ${escaped}`;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return el;
}

chatWindow.textContent = "👋 Hello! How can I help you today?";

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const userText = (userInput.value || "").trim();
  if (!userText) return;

  // Show user's message
  addMessage("User", userText);
  userInput.value = "";
  userInput.disabled = true;

  // Show a loading indicator and keep a reference so we can remove or replace it
  const loaderEl = addMessage("Assistant", "Thinking...");

  try {
    // Prepare messages array: system + user
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ];

    // Debug: confirm we're about to send the request
    console.debug("Sending request to worker:", WORKER_URL, { messages });

    // Call Cloudflare Worker which forwards the request to OpenAI
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // No Authorization header here — the worker holds the API key.
      },
      body: JSON.stringify({
        messages,
      }),
    });

    // Remove loader regardless of result
    loaderEl.remove();
    userInput.disabled = false;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        "Worker request failed:",
        response.status,
        response.statusText,
        text
      );
      addMessage(
        "Assistant",
        `Error: ${response.status} ${response.statusText}`
      );
      return;
    }

    // --- Changed: read raw response, log it, then parse safely ---
    const raw = await response.text().catch(() => "");
    console.debug("Worker raw response:", raw);

    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (parseErr) {
      console.error("Failed to parse worker JSON response:", parseErr, raw);
      addMessage(
        "Assistant",
        "Unexpected response format from the worker. Check browser console for details."
      );
      return;
    }

    // NEW: if the worker returned an error object (OpenAI-style), surface it clearly
    if (data && data.error) {
      console.error("API returned error payload:", data.error);
      const err = data.error;
      const code = err.code || err.type || "unknown_error";
      const msg = err.message || "An error occurred.";
      // Show a concise message to the user while keeping full details in the console
      addMessage("Assistant", `Error (${code}): ${msg}`);
      return;
    }

    // Cloudflare / Chat Completions response: data.choices[0].message.content
    const botContent =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content
        ? data.choices[0].message.content.trim()
        : (console.error("Missing choices in worker response:", data),
          "Sorry, I couldn't get a response.");

    addMessage("Assistant", botContent);
  } catch (err) {
    // Ensure loader removed and input re-enabled on error
    try {
      loaderEl.remove();
    } catch (e) {}
    userInput.disabled = false;
    console.error("Fetch error:", err);
    addMessage(
      "Assistant",
      "Sorry, something went wrong. Please try again later."
    );
  }
});
