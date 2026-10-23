"use strict";

(() => {
  function impact(record, key) {
    if (!record) return 0;
    const value = Math.max(0, Number(record?.valor) || 0);
    if (key === "lancamentos") {
      if (record.tipo === "entrada") return value;
      if (record.tipo === "despesa" && record.situacaoPagamento !== "Pendente") return -value;
      return 0;
    }
    if (key === "contas") {
      if (record.status === "pago" && record.tipo === "pagar") return -value;
      if (record.status === "recebido" && record.tipo === "receber") return value;
    }
    return 0;
  }

  function confirmShortfall(balance, description) {
    balance = Math.round(balance * 100) / 100;
    if (balance >= 0) return true;
    const shortfall = money(Math.abs(balance));
    return window.confirm(
      `Atenção: ${description} deixará seu saldo negativo em ${shortfall}. ` +
      "Você precisará cobrir esse valor no próximo mês. Deseja confirmar?"
    );
  }

  document.addEventListener("submit", event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "recordForm") return;

    const key = form.dataset.recordKey;
    if (key !== "lancamentos" && key !== "contas") return;
    if (key === "contas" && !form.dataset.recordId &&
        Number(form.elements.namedItem("parcelas")?.value) > 1) return;

    const values = Object.fromEntries(new FormData(form).entries());
    const amountFields = ["valor"];
    for (const name of amountFields) {
      if (values[name] !== undefined) values[name] = Number(values[name]) || 0;
    }
    if (key === "lancamentos" && values.tipo === "despesa" && !values.situacaoPagamento) {
      values.situacaoPagamento = "Paga";
    }

    const previous = form.dataset.recordId
      ? state.data[key].find(record => record.id === form.dataset.recordId)
      : null;
    const projectedBalance = currentCashBalance() + impact(values, key) - impact(previous, key);
    if (projectedBalance >= 0 || impact(values, key) >= impact(previous, key) ||
        confirmShortfall(projectedBalance, "esta operação")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const originalOpenForm = window.openForm;
  if (typeof originalOpenForm === "function") {
    window.openForm = function(key, preset = "", id = "") {
      originalOpenForm(key, preset, id);
      const form = document.querySelector("#recordForm");
      if (form) {
        form.dataset.recordKey = key;
        if (id) form.dataset.recordId = id;
      }
    };
  }

  const originalSettleAccount = window.settleAccount;
  if (typeof originalSettleAccount === "function") {
    window.settleAccount = async function(id) {
      const account = state.data.contas.find(item => item.id === id);
      if (account && account.tipo === "pagar" && !isPaid(account) &&
          !state.data.lancamentos.some(item => item.contaId === account.id)) {
        const projectedBalance = currentCashBalance() - (Number(account.valor) || 0);
        if (!confirmShortfall(projectedBalance, "o pagamento desta conta")) return;
      }
      return originalSettleAccount(id);
    };
  }

  const originalPayEmployeeSalary = window.payEmployeeSalary;
  if (typeof originalPayEmployeeSalary === "function") {
    window.payEmployeeSalary = async function(id) {
      const employee = state.data.funcionarios.find(item => item.id === id);
      if (employee && employee.status !== "Inativo" &&
          !(typeof employeeSalaryPayment === "function" && employeeSalaryPayment(employee, monthNow()))) {
        const amount = Number(employee.salario) || 0;
        const projectedBalance = currentCashBalance() - amount;
        if (amount > 0 && !confirmShortfall(projectedBalance, "o pagamento deste salário")) return;
        if (amount > 0 && Math.round(projectedBalance * 100) < 0) {
          const originalConfirm = window.confirm;
          try {
            window.confirm = () => true;
            return originalPayEmployeeSalary(id);
          } finally {
            window.confirm = originalConfirm;
          }
        }
      }
      return originalPayEmployeeSalary(id);
    };
  }
})();
