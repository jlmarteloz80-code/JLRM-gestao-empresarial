"use strict";

(() => {
  const content = document.querySelector("#content");
  if (!content) return;

  const styles = document.createElement("style");
  styles.textContent = `
    .goals-dashboard{margin-top:18px}
    .goals-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
    .goal-summary-card{padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
    .goal-summary-card span,.goal-summary-card strong{display:block}
    .goal-summary-card span{color:var(--muted);font-size:12px}
    .goal-summary-card strong{margin-top:5px;font-size:20px}
    .goal-chart-panel{margin:16px 0;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
    .goal-chart-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}
    .goal-chart-heading h2{margin:0;font-size:16px}
    .goal-chart-legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12px}
    .goal-chart-legend span{display:inline-flex;align-items:center;gap:6px}
    .goal-chart-key{width:9px;height:9px;border-radius:50%;background:#10b981}
    .goal-chart-key.remaining{background:#e5e7eb}
    .goal-chart-list{display:grid;gap:16px}
    .goal-chart-row{min-width:0}
    .goal-chart-row-head,.goal-chart-values{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
    .goal-chart-row-head{margin-bottom:7px}
    .goal-chart-row-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .goal-chart-row-head span,.goal-chart-values{color:var(--muted);font-size:12px}
    .goal-chart-track{display:flex;height:14px;overflow:hidden;border-radius:999px;background:#e5e7eb}
    .goal-chart-saved{height:100%;min-width:0;background:linear-gradient(90deg,#6366f1,#10b981);transition:width .3s ease}
    .goal-chart-values{margin-top:5px}
    .goal-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .goal-card{min-width:0;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow)}
    .goal-card-head,.goal-card-actions,.goal-progress-label,.goal-contribution-form{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .goal-card-head h3{margin:0;font-size:16px;overflow-wrap:anywhere}
    .goal-card-type,.goal-dates,.goal-history{color:var(--muted);font-size:12px}
    .goal-progress-label{margin:18px 0 7px;font-size:13px}
    .goal-progress{height:10px;overflow:hidden;border-radius:999px;background:var(--line)}
    .goal-progress-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,#6366f1,#10b981);transition:width .25s ease}
    .goal-value-row{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:12px;color:var(--muted)}
    .goal-value-row strong{color:var(--text)}
    .goal-contribution-form{align-items:flex-end;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
    .goal-contribution-form .field{flex:1 1 140px;margin:0}
    .goal-contribution-form .field label{display:block;margin-bottom:5px;font-size:12px}
    .goal-contribution-form input{width:100%;min-width:0}
    .goal-card-actions{justify-content:flex-start;margin-top:14px}
    .goal-history{margin:12px 0 0;padding-left:18px}
    .goal-history li{margin:4px 0}
    .goal-status{padding:4px 9px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:11px;white-space:nowrap}
    .goal-status.done{background:#d1fae5}
    .goal-status.late{background:#fff7ed;color:#c2410c}
    .goal-empty{grid-column:1/-1}
    .goal-manager-message{min-height:18px;margin:8px 0 0;color:var(--muted);font-size:12px}
    @media(max-width:760px){.goals-summary{grid-template-columns:1fr}.goal-list{grid-template-columns:1fr}.goal-card-head,.goal-value-row{align-items:flex-start}.goal-chart-heading{flex-direction:column}}
  `;
  document.head.append(styles);

  function buildElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function dateLabel(value) {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR");
  }

  function goalStatus(goal, current, target) {
    if (target > 0 && current >= target) return ["Concluída", "done"];
    if (goal.fim && goal.fim < today()) return ["Prazo encerrado", "late"];
    return ["Em andamento", ""];
  }

  function summaryCard(label, value) {
    const card = buildElement("div", "goal-summary-card");
    card.append(buildElement("span", "", label), buildElement("strong", "", value));
    return card;
  }

  function renderGoalChart(goals) {
    const panel = buildElement("section", "goal-chart-panel");
    const header = buildElement("div", "goal-chart-heading");
    const title = buildElement("div");
    title.append(
      buildElement("h2", "", "Progresso financeiro das metas"),
      buildElement("div", "panel-sub", "Veja quanto já foi guardado e quanto falta para cada objetivo.")
    );
    const legend = buildElement("div", "goal-chart-legend");
    const savedKey = buildElement("i", "goal-chart-key");
    const remainingKey = buildElement("i", "goal-chart-key remaining");
    const savedLabel = buildElement("span");
    savedLabel.append(savedKey, document.createTextNode("Já guardado"));
    const remainingLabel = buildElement("span");
    remainingLabel.append(remainingKey, document.createTextNode("Falta"));
    legend.append(savedLabel, remainingLabel);
    header.append(title, legend);
    panel.append(header);

    const rows = buildElement("div", "goal-chart-list");
    for (const goal of goals) {
      const current = Math.max(0, Number(goal.atual) || 0);
      const target = Math.max(0, Number(goal.valor) || 0);
      const percent = target > 0 ? Math.min(100, current / target * 100) : 0;
      const row = buildElement("div", "goal-chart-row");
      const rowHeader = buildElement("div", "goal-chart-row-head");
      rowHeader.append(
        buildElement("strong", "", goal.nome || "Meta sem nome"),
        buildElement("span", "", `${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`)
      );
      const track = buildElement("div", "goal-chart-track");
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", `${goal.nome || "Meta"}: ${money(current)} guardados de ${money(target)}`);
      const saved = buildElement("div", "goal-chart-saved");
      saved.style.width = `${percent}%`;
      track.append(saved);
      const values = buildElement("div", "goal-chart-values");
      values.append(
        buildElement("span", "", `Guardado: ${money(current)}`),
        buildElement("span", "", `Falta: ${money(Math.max(0, target - current))} · Objetivo: ${money(target)}`)
      );
      row.append(rowHeader, track, values);
      rows.append(row);
    }
    if (!goals.length) {
      rows.append(buildElement("div", "empty", "Crie sua primeira meta para acompanhar o progresso financeiro neste gráfico."));
    }
    panel.append(rows);
    return panel;
  }

  function renderGoalCard(goal) {
    const current = Number(goal.atual) || 0;
    const target = Number(goal.valor) || 0;
    const progress = target > 0 ? Math.min(100, Math.max(0, current / target * 100)) : 0;
    const [status, statusClass] = goalStatus(goal, current, target);
    const card = buildElement("article", "goal-card");
    const header = buildElement("div", "goal-card-head");
    const titleGroup = buildElement("div");
    titleGroup.append(buildElement("h3", "", goal.nome || "Meta sem nome"));
    titleGroup.append(buildElement("div", "goal-card-type", goal.tipo || "Meta financeira"));
    header.append(titleGroup, buildElement("span", `goal-status ${statusClass}`, status));
    card.append(header);

    const progressLabel = buildElement("div", "goal-progress-label");
    progressLabel.append(buildElement("strong", "", `${progress.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% concluído`));
    progressLabel.append(buildElement("span", "", `${money(Math.max(0, target - current))} restantes`));
    card.append(progressLabel);

    const progressBar = buildElement("div", "goal-progress");
    const fill = buildElement("div", "goal-progress-fill");
    fill.style.width = `${progress}%`;
    progressBar.append(fill);
    card.append(progressBar);

    const values = buildElement("div", "goal-value-row");
    const currentValue = buildElement("span");
    currentValue.append(document.createTextNode("Acumulado "), buildElement("strong", "", money(current)));
    const targetValue = buildElement("span");
    targetValue.append(document.createTextNode("Objetivo "), buildElement("strong", "", money(target)));
    values.append(currentValue, targetValue);
    card.append(values);

    if (goal.inicio || goal.fim) {
      const dates = [goal.inicio ? `Início: ${dateLabel(goal.inicio)}` : "", goal.fim ? `Prazo: ${dateLabel(goal.fim)}` : ""].filter(Boolean);
      card.append(buildElement("p", "goal-dates", dates.join(" · ")));
    }

    const form = buildElement("form", "goal-contribution-form");
    form.dataset.goalId = goal.id;
    const amountField = buildElement("div", "field");
    const amountLabel = buildElement("label", "", "Adicionar saldo (R$)");
    const amountInput = document.createElement("input");
    amountInput.name = "valor";
    amountInput.type = "number";
    amountInput.min = "0.01";
    amountInput.step = "0.01";
    amountInput.placeholder = "Ex.: 100,00";
    amountInput.required = true;
    amountField.append(amountLabel, amountInput);
    const noteField = buildElement("div", "field");
    const noteLabel = buildElement("label", "", "Observação (opcional)");
    const noteInput = document.createElement("input");
    noteInput.name = "observacao";
    noteInput.maxLength = 120;
    noteInput.placeholder = "Ex.: economia do mês";
    noteField.append(noteLabel, noteInput);
    const submit = buildElement("button", "btn primary", "Adicionar");
    submit.type = "submit";
    form.append(amountField, noteField, submit);
    card.append(form);

    const history = Array.isArray(goal.aportes) ? [...goal.aportes].sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))) : [];
    if (history.length) {
      const list = buildElement("ul", "goal-history");
      for (const entry of history.slice(0, 5)) {
        const note = entry.observacao ? ` · ${entry.observacao}` : "";
        list.append(buildElement("li", "", `${dateLabel(entry.data)} — ${money(entry.valor)}${note}`));
      }
      card.append(list);
      if (history.length > 5) card.append(buildElement("div", "goal-dates", `Mostrando os 5 aportes mais recentes de ${history.length}.`));
    }

    const actions = buildElement("div", "goal-card-actions");
    const edit = buildElement("button", "btn small", "Editar meta");
    edit.type = "button";
    edit.dataset.goalEdit = goal.id;
    const remove = buildElement("button", "btn small danger", "Excluir");
    remove.type = "button";
    remove.dataset.goalDelete = goal.id;
    actions.append(edit, remove);
    card.append(actions);
    return card;
  }

  function renderDashboard(section) {
    const goals = Array.isArray(state.data.metas) ? state.data.metas : [];
    section.replaceChildren();
    section.classList.add("goal-list");
    const header = buildElement("div", "panel-head");
    const heading = buildElement("div");
    heading.append(buildElement("h2", "", "Painel de metas"));
    heading.append(buildElement("div", "panel-sub", "Acompanhe objetivos, registre novos aportes e veja o histórico de cada meta."));
    const add = buildElement("button", "btn primary", "＋ Nova meta");
    add.type = "button";
    add.dataset.goalNew = "true";
    const page = document.createElement("section");
    page.className = "goals-dashboard";
    const pageHeading = buildElement("div", "page-head");
    const pageHeadingContent = buildElement("div");
    pageHeadingContent.append(
      buildElement("h1", "", "Metas"),
      buildElement("p", "", "Organize seus objetivos, acompanhe o progresso e registre cada valor guardado.")
    );
    pageHeading.append(pageHeadingContent);
    page.append(pageHeading);
    const panel = buildElement("section", "panel");
    header.append(heading, add);
    panel.append(header);

    const total = goals.reduce((sum, goal) => sum + (Number(goal.valor) || 0), 0);
    const accumulated = goals.reduce((sum, goal) => sum + (Number(goal.atual) || 0), 0);
    const completed = goals.filter(goal => Number(goal.valor) > 0 && Number(goal.atual) >= Number(goal.valor)).length;
    const metrics = buildElement("div", "goals-summary");
    metrics.append(
      summaryCard("Metas cadastradas", String(goals.length)),
      summaryCard("Valor dos objetivos", money(total)),
      summaryCard("Total acumulado", money(accumulated)),
      summaryCard("Objetivos concluídos", `${completed} de ${goals.length}`)
    );
    panel.append(metrics);
    panel.append(renderGoalChart(goals));

    const list = buildElement("div", "goal-list");
    if (!goals.length) {
      const empty = buildElement("div", "empty goal-empty", "Você ainda não criou metas. Comece com um objetivo, como juntar dinheiro para um carro, e registre cada aporte por aqui.");
      list.append(empty);
    } else {
      for (const goal of goals) list.append(renderGoalCard(goal));
    }
    panel.append(list, buildElement("p", "goal-manager-message", "O valor adicionado atualiza somente esta meta; não altera o caixa da empresa."));
    page.append(panel);
    section.replaceWith(page);
  }

  window.renderGoalManagementPage = root => {
    if (root) renderDashboard(root);
  };

  function showGoalsPage() {
    state.page = "metas";
    document.querySelectorAll("[data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === "metas");
    });
    const title = document.querySelector("#topTitle");
    if (title) title.textContent = "Metas";
    document.querySelector("#sidebar")?.classList.remove("open");
    const quickAdd = document.querySelector("#quickAdd");
    if (quickAdd) {
      quickAdd.hidden = false;
      quickAdd.dataset.form = "metas";
      quickAdd.setAttribute("aria-label", "Nova meta");
      const label = quickAdd.querySelector(".btn-label");
      if (label) label.textContent = "Nova meta";
    }
    content.replaceChildren();
    const root = document.createElement("div");
    root.id = "goalManagementRoot";
    content.append(root);
    renderDashboard(root);
  }

  function enhance() {
    if (state.page === "metas" && !content.querySelector(".goals-dashboard")) {
      const root = document.createElement("div");
      root.id = "goalManagementRoot";
      content.replaceChildren(root);
      renderDashboard(root);
      const quickAdd = document.querySelector("#quickAdd");
      if (quickAdd) {
        quickAdd.hidden = false;
        quickAdd.dataset.form = "metas";
        quickAdd.setAttribute("aria-label", "Nova meta");
        const label = quickAdd.querySelector(".btn-label");
        if (label) label.textContent = "Nova meta";
      }
    }

  }

  const originalRender = window.render;
  if (typeof originalRender === "function") {
    window.render = function(...args) {
      if (state.page !== "metas") return originalRender.apply(this, args);
      updateQuickAction();
      const quickAdd = document.querySelector("#quickAdd");
      if (quickAdd) {
        quickAdd.hidden = false;
        quickAdd.dataset.form = "metas";
        quickAdd.setAttribute("aria-label", "Nova meta");
        const label = quickAdd.querySelector(".btn-label");
        if (label) label.textContent = "Nova meta";
      }
      content.replaceChildren();
      const root = document.createElement("div");
      root.id = "goalManagementRoot";
      content.append(root);
      renderDashboard(root);
    };
  }

  content.addEventListener("submit", async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches(".goal-contribution-form")) return;
    event.preventDefault();
    const goal = state.data.metas.find(item => item.id === form.dataset.goalId);
    const amount = Number(new FormData(form).get("valor"));
    const note = String(new FormData(form).get("observacao") || "").trim();
    if (!goal || !Number.isFinite(amount) || amount <= 0) {
      toast("Informe um valor de aporte válido.");
      return;
    }
    const previousCurrent = Number(goal.atual) || 0;
    const previousContributions = Array.isArray(goal.aportes) ? [...goal.aportes] : undefined;
    goal.atual = Math.round((previousCurrent + amount) * 100) / 100;
    if (!Array.isArray(goal.aportes)) goal.aportes = [];
    goal.aportes.push({ id: uid(), valor: amount, data: today(), observacao: note });
    if (await saveData("metas")) {
      toast(`Aporte de ${money(amount)} adicionado à meta "${goal.nome}".`);
      showGoalsPage();
      return;
    }
    goal.atual = previousCurrent;
    if (previousContributions) goal.aportes = previousContributions;
    else delete goal.aportes;
  });

  content.addEventListener("click", event => {
    const target = event.target.closest("[data-goal-new], [data-goal-edit], [data-goal-delete]");
    if (!target) return;
    if (target.hasAttribute("data-goal-new")) {
      openForm("metas");
    } else if (target.dataset.goalEdit) {
      editRecord("metas", target.dataset.goalEdit);
    } else if (target.dataset.goalDelete) {
      deleteRecord("metas", target.dataset.goalDelete);
    }
  });

  document.querySelector("#sidebar")?.addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    if (button.dataset.page !== "metas") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showGoalsPage();
  }, true);

  const observer = new MutationObserver(enhance);
  observer.observe(content, { childList: true, subtree: true });
  enhance();
})();
