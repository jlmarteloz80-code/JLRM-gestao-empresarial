"use strict";

(() => {
  const STORAGE_KEY = "orbe_saved_investment_simulations_v1";
  let activeSavedId = null;
  let internalSubmit = false;

  function readSavedSimulations() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const simulations = JSON.parse(raw);
    if (!Array.isArray(simulations)) {
      throw new Error("Os investimentos salvos neste aparelho estão em um formato inválido.");
    }
    return simulations;
  }

  function writeSavedSimulations(simulations) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(simulations));
  }

  function makeButton(label, className, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function showStatus(container, message, isError = false) {
    const status = container.querySelector(".device-simulation-status");
    status.textContent = message;
    status.style.color = isError ? "var(--red)" : "";
  }

  function initializeSimulator(form) {
    if (form.dataset.deviceSaveInitialized) return;
    form.dataset.deviceSaveInitialized = "true";

    const saveButton = makeButton("Salvar investimento", "btn", () => {
      if (!form.reportValidity()) return;
      internalSubmit = true;
      form.requestSubmit();
      internalSubmit = false;

      const result = document.querySelector("#investmentSimulatorResult");
      const summary = result?.innerText.trim();
      if (!summary || result.querySelector(".empty")) {
        showStatus(panel, "Calcule a projeção antes de salvar.", true);
        return;
      }

      try {
        const simulations = readSavedSimulations();
        const saved = {
          id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          savedAt: new Date().toISOString(),
          inputs: Object.fromEntries(new FormData(form).entries()),
          summary
        };
        simulations.unshift(saved);
        writeSavedSimulations(simulations);
        activeSavedId = saved.id;
        renderSavedSimulations(panel, form);
        showStatus(panel, "Resumo salvo neste aparelho.");
      } catch (error) {
        showStatus(panel, `Não foi possível salvar: ${error.message}`, true);
      }
    });
    const submitField = form.querySelector('button[type="submit"]')?.closest(".field");
    if (submitField) submitField.append(saveButton);

    const panel = document.createElement("section");
    panel.className = "device-simulations";
    panel.innerHTML = '<div class="panel-head"><div><h2>Simulações salvas neste aparelho</h2><div class="panel-sub">Toque em “Ver no gráfico” para abrir uma projeção salva.</div></div></div><div class="device-simulations-list"></div><p class="device-simulation-status" role="status" aria-live="polite"></p>';
    const chart = form.closest(".simulator-panel")?.querySelector(".simulator-chart");
    if (chart) chart.after(panel);

    form.addEventListener("submit", () => {
      if (!internalSubmit) activeSavedId = null;
    });
    renderSavedSimulations(panel, form);
  }

  function renderSavedSimulations(panel, form) {
    const list = panel.querySelector(".device-simulations-list");
    list.replaceChildren();
    let simulations;
    try {
      simulations = readSavedSimulations();
    } catch (error) {
      showStatus(panel, error.message, true);
      return;
    }

    if (!simulations.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Nenhuma simulação salva neste aparelho.";
      list.append(empty);
      return;
    }

    for (const simulation of simulations) {
      const item = document.createElement("article");
      item.className = "device-simulation";
      const description = document.createElement("div");
      description.className = "device-simulation-summary";
      const title = document.createElement("strong");
      title.textContent = new Date(simulation.savedAt).toLocaleString("pt-BR");
      const summary = document.createElement("small");
      summary.textContent = simulation.summary;
      description.append(title, summary);

      const actions = document.createElement("div");
      actions.className = "device-simulation-actions";
      actions.append(
        makeButton("Ver no gráfico", "btn small", () => {
          if (!simulation.inputs || typeof simulation.inputs !== "object") {
            showStatus(panel, "Esta simulação salva não possui os dados necessários para abrir o gráfico.", true);
            return;
          }
          for (const [name, value] of Object.entries(simulation.inputs)) {
            if (form.elements.namedItem(name)) form.elements.namedItem(name).value = value;
          }
          activeSavedId = simulation.id;
          internalSubmit = true;
          form.requestSubmit();
          internalSubmit = false;
          showStatus(panel, "Gráfico atualizado com a simulação salva.");
        }),
        makeButton("Excluir", "btn small danger", () => {
          if (!window.confirm("Excluir esta simulação salva neste aparelho?")) return;
          try {
            const remaining = readSavedSimulations().filter(item => item.id !== simulation.id);
            writeSavedSimulations(remaining);
            if (activeSavedId === simulation.id) {
              activeSavedId = null;
              if (remaining.length) {
                const latest = remaining[0];
                for (const [name, value] of Object.entries(latest.inputs || {})) {
                  if (form.elements.namedItem(name)) form.elements.namedItem(name).value = value;
                }
                activeSavedId = latest.id;
                internalSubmit = true;
                form.requestSubmit();
                internalSubmit = false;
                showStatus(panel, "Simulação excluída. O gráfico mostra a simulação salva mais recente.");
              } else {
                if (typeof simulatorLast !== "undefined") simulatorLast = null;
                const result = document.querySelector("#investmentSimulatorResult");
                result.innerHTML = '<div class="empty">Informe os valores e calcule para ver o resultado estimado.</div>';
                const canvas = document.querySelector("#simulatorChart");
                canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
                showStatus(panel, "Simulação excluída.");
              }
            } else {
              showStatus(panel, "Simulação excluída.");
            }
            renderSavedSimulations(panel, form);
          } catch (error) {
            showStatus(panel, `Não foi possível excluir: ${error.message}`, true);
          }
        })
      );
      item.append(description, actions);
      list.append(item);
    }
  }

  const content = document.querySelector("#content");
  if (!content) return;
  const observer = new MutationObserver(() => {
    const form = content.querySelector("#investmentSimulatorForm");
    if (form) initializeSimulator(form);
  });
  observer.observe(content, { childList: true, subtree: true });
  const initialForm = content.querySelector("#investmentSimulatorForm");
  if (initialForm) initializeSimulator(initialForm);
})();
