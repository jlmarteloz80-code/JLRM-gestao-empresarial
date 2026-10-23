"use strict";

(() => {
  function addMonths(dateString, monthOffset) {
    const [year, month, day] = dateString.split("-").map(Number);
    const targetMonth = month - 1 + monthOffset;
    const targetYear = year + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
    const targetDay = Math.min(day, lastDay);
    return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
  }

  document.addEventListener("submit", async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "recordForm" ||
        !form.elements.namedItem("parcelas") ||
        document.querySelector("#modalTitle")?.textContent.includes("Editar conta")) return;

    const count = Number(form.elements.namedItem("parcelas").value) || 1;
    if (count === 1) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!Number.isInteger(count) || count < 1 || count > 600) {
      toast("Informe um número de parcelas entre 1 e 600.");
      return;
    }

    const formData = new FormData(form);
    const account = Object.fromEntries(formData.entries());
    const totalCents = Math.round(Number(account.valor) * 100);
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
      toast("Informe um valor total válido para dividir em parcelas.");
      return;
    }
    if (totalCents < count) {
      toast("O valor total precisa ser suficiente para criar parcelas de pelo menos R$ 0,01.");
      return;
    }

    const dueDate = account.vencimento;
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      toast("Informe uma data de vencimento válida.");
      return;
    }

    for (const [key, value] of Object.entries(account)) {
      if (["valor", "parcelas"].includes(key)) account[key] = Number(value) || 0;
    }
    const baseCents = Math.floor(totalCents / count);
    const remainingCents = totalCents - baseCents * count;
    const groupId = uid();
    const now = new Date().toISOString();
    const records = Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      return {
        ...account,
        id: uid(),
        descricaoBase: account.descricao,
        descricao: `${account.descricao} - parcela ${number}/${count}`,
        valor: (baseCents + (index < remainingCents ? 1 : 0)) / 100,
        vencimento: addMonths(dueDate, index),
        status: "pendente",
        parcelas: count,
        parcelaNumero: number,
        totalParcelas: count,
        grupoParcelasId: groupId,
        criadoEm: now
      };
    });

    state.data.contas.push(...records);
    if (await saveData("contas")) {
      closeModal();
      toast(`Conta cadastrada em ${count} parcelas. Marque cada parcela como paga separadamente.`);
      render();
      return;
    }
    const ids = new Set(records.map(record => record.id));
    state.data.contas = state.data.contas.filter(record => !ids.has(record.id));
  }, true);
})();
