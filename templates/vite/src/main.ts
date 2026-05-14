import "./style.css";

type ApiResponse = {
  ok: boolean;
  message: string;
  visits: number;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = `
  <main class="shell">
    <p class="eyebrow">Cloudflare Vite starter</p>
    <h1>Ship a frontend and a stage-aware worker from one repo.</h1>
    <p class="lede">The Vite app talks to a worker API, and wrangler-deploy handles the stage lifecycle.</p>
    <button id="refresh">Refresh data</button>
    <pre id="output">Loading...</pre>
  </main>
`;

const output = document.querySelector<HTMLElement>("#output");
const button = document.querySelector<HTMLButtonElement>("#refresh");

if (!output || !button) {
  throw new Error("Starter UI failed to initialize");
}

async function loadData() {
  const res = await fetch("/api");
  const data = (await res.json()) as ApiResponse;
  output.textContent = JSON.stringify(data, null, 2);
}

button.addEventListener("click", () => {
  void loadData();
});

void loadData();
