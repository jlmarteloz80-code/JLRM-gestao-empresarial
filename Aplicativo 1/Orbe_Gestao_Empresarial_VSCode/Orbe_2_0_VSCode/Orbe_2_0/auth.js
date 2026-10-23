"use strict";

(() => {
  const overlay = document.createElement("div");
  overlay.id = "loginScreen";
  overlay.innerHTML = `
    <style>
      #loginScreen{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:#f3f5fa;font:14px/1.5 system-ui,sans-serif;color:#182230}
      #loginScreen[hidden]{display:none}
      .login-card{width:min(420px,100%);padding:30px;background:#fff;border:1px solid #e4e8f0;border-radius:18px;box-shadow:0 16px 48px #18223018}
      .login-card h1{margin:0;font-size:24px}.login-card p{margin:7px 0 22px;color:#687386}
      .login-card label{display:block;margin:14px 0 6px;font-weight:650}
      .login-card input{width:100%;padding:11px;border:1px solid #dce2eb;border-radius:9px;font:inherit}
      .login-card button{width:100%;margin-top:20px;padding:11px;border:0;border-radius:9px;background:#4f46e5;color:white;font:inherit;font-weight:700;cursor:pointer}
      .login-error{min-height:0;margin-top:0;color:#b42332;font-size:13px}
      .login-error:not(:empty){min-height:20px;margin-top:12px}
      .login-note{font-size:12px;color:#687386}
      body.dark #loginScreen{background:#0b1120;color:#e5e7eb}.dark .login-card{background:#111827;border-color:#374151}.dark .login-card input{background:#111827;color:#e5e7eb;border-color:#374151}
    </style>
    <section class="login-card" aria-labelledby="loginTitle">
      <h1 id="loginTitle">Entrar no JLRM</h1>
      <p>Acesse com seu usuário e senha.</p>
      <form id="loginForm">
        <label for="loginUsername">Usuário</label>
        <input id="loginUsername" name="username" autocomplete="username" required>
        <label for="loginPassword">Senha</label>
        <input id="loginPassword" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Entrar</button>
        <div class="login-error" id="loginError" role="alert"></div>
      </form>
    </section>`;
  document.body.append(overlay);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js")
      .catch(error => console.warn("Não foi possível ativar o modo instalável:", error.message));
  }

  function showLogin(message = "") {
    overlay.hidden = false;
    document.querySelector(".app").style.display = "none";
    document.body.style.overflow = "hidden";
    document.querySelector("#loginError").textContent = message;
  }

  function hideLogin() {
    overlay.hidden = true;
    document.querySelector(".app").style.display = "";
    document.body.style.overflow = "";
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    let body;
    try {
      body = await response.json();
    } catch {
      if (!response.ok) throw new Error(`Não foi possível concluir a solicitação (HTTP ${response.status}).`);
      throw new Error("O servidor retornou uma resposta inválida.");
    }
    if (!response.ok) {
      const detail = body.detail ? ` ${body.detail}` : "";
      const code = body.code ? ` [${body.code}]` : "";
      throw new Error((body.error || "Não foi possível concluir a solicitação.") + code + detail);
    }
    return body;
  }

  overlay.querySelector("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password")
        })
      });
      location.reload();
    } catch (error) {
      document.querySelector("#loginError").textContent = error instanceof TypeError
        ? "Não foi possível conectar ao servidor. Verifique se ele está iniciado e tente novamente."
        : error.message;
      button.disabled = false;
    }
  });

  window.OrbeAuth = {
    async requireSession() {
      try {
        const result = await request("/api/auth/session");
        hideLogin();
        const nav = document.querySelector("#usersNav");
        if (nav) nav.style.display = result.user.role === "admin" ? "" : "none";
        const topActions = document.querySelector(".top-actions");
        if (!document.querySelector("#logoutButton")) {
          const logout = document.createElement("button");
          logout.id = "logoutButton";
          logout.className = "btn";
          logout.textContent = `Sair (${result.user.username})`;
          logout.addEventListener("click", async () => {
            try {
              await request("/api/auth/logout", { method: "POST", body: "{}" });
              location.reload();
            } catch (error) {
              alert(error.message);
            }
          });
          topActions.append(logout);
        }
        return result.user;
      } catch {
        showLogin();
        return null;
      }
    },
    request
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  async function refreshUsers() {
    const list = document.querySelector("#loginUsers");
    if (!list) return;
    try {
      const result = await request("/api/admin/users");
      list.innerHTML = result.users.map(user =>
        `<tr><td>${escapeHtml(user.username)}</td><td>${user.role === "admin" ? "Administrador" : "Usuário"}</td><td><button type="button" class="btn small" data-reset-user="${escapeHtml(user.username)}">Redefinir senha</button>${user.role !== "admin" ? ` <button type="button" class="btn small danger" data-delete-user="${escapeHtml(user.username)}">Excluir login</button>` : ""}</td></tr>`
      ).join("");
    } catch (error) {
      const message = document.querySelector("#usersMessage");
      if (message) message.textContent = error.message;
    }
  }

  function renderFullBackupPanel() {
    if (document.querySelector("#fullSystemBackup")) return;
    const content = document.querySelector("#content");
    if (!content) return;
    const panel = document.createElement("section");
    panel.id = "fullSystemBackup";
    panel.className = "panel";
    panel.style.marginTop = "18px";
    panel.innerHTML = `
      <h2>Backup completo do sistema</h2>
      <p class="panel-sub">Inclui todos os logins e os dados de todas as contas. Para voltar tudo, selecione aqui o JSON salvo. A restauração substitui os dados atuais e encerra as sessões. Guarde o arquivo fora do servidor; ele contém hashes de senha e é confidencial.</p>
      <div class="quick-actions" style="margin-top:14px">
        <button type="button" class="btn primary" data-full-backup-download>Baixar backup de todos</button>
        <button type="button" class="btn" data-full-backup-restore>Enviar JSON e recarregar todos os dados</button>
        <input type="file" id="fullBackupFile" accept=".json,application/json" class="hide">
      </div>
      <h3 style="margin:20px 0 6px">Cópia automática no seu computador</h3>
      <p class="panel-sub">Escolha uma pasta local. O arquivo de backup completo será atualizado a cada cinco minutos enquanto esta página estiver aberta.</p>
      <div class="quick-actions" style="margin-top:10px">
        <button type="button" class="btn" data-local-backup-folder>Escolher pasta no computador</button>
      </div>
      <div class="panel-sub" id="localBackupMessage" role="status" style="margin-top:8px"></div>
      <div class="panel-sub" id="fullBackupMessage" role="status" style="margin-top:10px"></div>`;
    content.append(panel);
  }

  const LOCAL_BACKUP_DATABASE = "orbe-local-backup";
  const LOCAL_BACKUP_STORE = "settings";
  const LOCAL_BACKUP_HANDLE_KEY = "backup-directory";
  const LOCAL_BACKUP_INTERVAL = 5 * 60 * 1000;
  let localBackupTimer = null;
  let localBackupInProgress = false;

  function openLocalBackupDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(LOCAL_BACKUP_DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(LOCAL_BACKUP_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento das preferências de backup."));
    });
  }

  async function storeLocalBackupDirectory(handle) {
    const database = await openLocalBackupDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(LOCAL_BACKUP_STORE, "readwrite");
        transaction.objectStore(LOCAL_BACKUP_STORE).put(handle, LOCAL_BACKUP_HANDLE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Não foi possível salvar a pasta escolhida."));
        transaction.onabort = () => reject(transaction.error || new Error("Não foi possível salvar a pasta escolhida."));
      });
    } finally {
      database.close();
    }
  }

  async function getLocalBackupDirectory() {
    const database = await openLocalBackupDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(LOCAL_BACKUP_STORE, "readonly");
        const request = transaction.objectStore(LOCAL_BACKUP_STORE).get(LOCAL_BACKUP_HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Não foi possível recuperar a pasta de backup."));
      });
    } finally {
      database.close();
    }
  }

  async function hasLocalBackupPermission(handle, requestPermission = false) {
    const options = { mode: "readwrite" };
    if (await handle.queryPermission(options) === "granted") return true;
    return requestPermission && await handle.requestPermission(options) === "granted";
  }

  function setLocalBackupMessage(message) {
    const status = document.querySelector("#localBackupMessage");
    if (status) status.textContent = message;
  }

  function getBackupRecordCount(backup) {
    if (!backup || !backup.accounts || typeof backup.accounts !== "object" ||
        Array.isArray(backup.accounts)) {
      throw new Error("O arquivo de backup local tem uma estrutura inválida e foi preservado.");
    }
    return Object.values(backup.accounts).reduce((total, account) => {
      if (!account || typeof account !== "object" || Array.isArray(account)) {
        throw new Error("O arquivo de backup local tem uma estrutura inválida e foi preservado.");
      }
      return total + Object.values(account).reduce(
        (accountTotal, value) => accountTotal + (Array.isArray(value) ? value.length : 0),
        0
      );
    }, 0);
  }

  function isLocalBackupRegression(current, previous) {
    if (previous.format !== "orbe-full-backup-v1" ||
        !Array.isArray(previous.users) || !Array.isArray(current.users) ||
        !previous.accounts || typeof previous.accounts !== "object" ||
        !current.accounts || typeof current.accounts !== "object") {
      throw new Error("O arquivo de backup local não é válido e foi preservado.");
    }
    const currentUsers = new Set(current.users.map(user => user.username));
    if (previous.users.some(user => !currentUsers.has(user.username))) return true;
    getBackupRecordCount(current);
    getBackupRecordCount(previous);
    return Object.entries(previous.accounts).some(([username, previousAccount]) => {
      const currentAccount = current.accounts[username];
      if (!currentAccount) return true;
      return Object.entries(previousAccount).some(([category, previousValue]) => {
        const currentValue = currentAccount[category];
        return Array.isArray(previousValue) &&
          (!Array.isArray(currentValue) || currentValue.length < previousValue.length);
      });
    });
  }

  async function writeLocalFullBackup(handle) {
    if (localBackupInProgress) return;
    localBackupInProgress = true;
    try {
      if (!await hasLocalBackupPermission(handle)) {
        setLocalBackupMessage("O navegador precisa de acesso à pasta. Clique em “Escolher pasta no computador” novamente.");
        return;
      }
      const response = await fetch("/api/admin/backup", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        let body = {};
        try { body = await response.json(); } catch {}
        if (response.status === 401 || response.status === 403) {
          if (localBackupTimer) clearInterval(localBackupTimer);
          localBackupTimer = null;
        }
        throw new Error(body.error || `O servidor respondeu HTTP ${response.status}.`);
      }
      const backup = await response.text();
      const currentBackup = JSON.parse(backup);
      let existingBackupHandle;
      try {
        existingBackupHandle = await handle.getFileHandle("orbe_backup_completo_automatico.json");
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      if (existingBackupHandle) {
        const existingBackup = JSON.parse(await (await existingBackupHandle.getFile()).text());
        if (isLocalBackupRegression(currentBackup, existingBackup)) {
          setLocalBackupMessage(
            `O servidor está com menos contas ou dados que o backup local. ` +
            `O arquivo anterior foi preservado para não perder informações. ` +
            `Restaure-o em “Enviar JSON e recarregar todos os dados”.`
          );
          return;
        }
      }
      const timestamp = new Date(currentBackup.exportedAt);
      if (Number.isNaN(timestamp.getTime())) {
        throw new Error("O servidor retornou um horário de backup inválido.");
      }
      const timestampedName = `orbe_backup_completo_${timestamp.toISOString().replace(/[:.]/g, "-")}.json`;
      const timestampedFile = await handle.getFileHandle(timestampedName, { create: true });
      for (const file of [
        timestampedFile,
        existingBackupHandle || await handle.getFileHandle("orbe_backup_completo_automatico.json", { create: true })
      ]) {
        const writable = await file.createWritable();
        try {
          await writable.write(backup);
          await writable.close();
        } catch (error) {
          await writable.abort();
          throw error;
        }
      }
      setLocalBackupMessage(
        `Nova cópia completa salva no seu computador: ${timestamp.toLocaleString("pt-BR")}. ` +
        "As cópias anteriores foram mantidas."
      );
    } catch (error) {
      setLocalBackupMessage(`Falha no backup local: ${error.message}`);
    } finally {
      localBackupInProgress = false;
    }
  }

  function startLocalBackupSchedule(handle) {
    if (localBackupTimer) clearInterval(localBackupTimer);
    writeLocalFullBackup(handle);
    localBackupTimer = setInterval(() => writeLocalFullBackup(handle), LOCAL_BACKUP_INTERVAL);
  }

  async function resumeLocalBackupSchedule() {
    const status = document.querySelector("#localBackupMessage");
    if (!status) return;
    if (!window.showDirectoryPicker) {
      setLocalBackupMessage("A gravação automática em pasta exige Chrome ou Edge no computador.");
      return;
    }
    try {
      const handle = await getLocalBackupDirectory();
      if (!handle) {
        setLocalBackupMessage("Escolha uma pasta para iniciar as cópias automáticas.");
        return;
      }
      if (!await hasLocalBackupPermission(handle)) {
        setLocalBackupMessage("Clique em “Escolher pasta no computador” para reautorizar o acesso à pasta.");
        return;
      }
      startLocalBackupSchedule(handle);
    } catch (error) {
      setLocalBackupMessage(`Não foi possível preparar o backup local: ${error.message}`);
    }
  }

  async function downloadFullBackup(button) {
    const message = document.querySelector("#fullBackupMessage");
    button.disabled = true;
    try {
      const response = await fetch("/api/admin/backup");
      if (!response.ok) {
        let body = {};
        try { body = await response.json(); } catch {}
        throw new Error(body.error || `Não foi possível baixar o backup (HTTP ${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ||
        "orbe_backup_completo.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      message.textContent = "Backup completo baixado. Guarde o arquivo em local seguro.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  window.renderUsersPage = () => {
    if (!state.user || state.user.role !== "admin") {
      return `<section class="panel"><div class="empty">Apenas o administrador pode gerenciar logins.</div></section>`;
    }
    setTimeout(() => {
      refreshUsers();
      renderFullBackupPanel();
      resumeLocalBackupSchedule();
    }, 0);
    return `${pageHead("Logins de acesso", "Crie e consulte as contas de acesso ao aplicativo.")}<div class="settings-grid"><section class="panel"><h2>Criar login</h2><form id="createLoginForm" class="form-grid" style="margin-top:15px"><div class="field full"><label>Usuário</label><input name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]+" required></div><div class="field full"><label>Senha (mínimo de 8 caracteres)</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="form-actions full"><button class="btn primary">Criar acesso</button></div></form><div id="usersMessage" class="panel-sub" role="status"></div></section><section class="panel"><h2>Trocar minha senha</h2><form id="changePasswordForm" class="form-grid" style="margin-top:15px"><div class="field full"><label>Senha atual</label><input name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field full"><label>Nova senha (mínimo de 8 caracteres)</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="form-actions full"><button class="btn">Atualizar senha</button></div></form></section></div><section class="panel" id="resetPasswordPanel" style="margin-top:18px" hidden></section><section class="panel" style="margin-top:18px"><h2>Contas cadastradas</h2><div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Usuário</th><th>Permissão</th><th>Ações</th></tr></thead><tbody id="loginUsers"><tr><td colspan="3">Carregando...</td></tr></tbody></table></div></section>`;
  };

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-reset-user]");
    if (!button) return;
    const username = button.dataset.resetUser;
    const panel = document.querySelector("#resetPasswordPanel");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = `<h2>Redefinir senha: ${escapeHtml(username)}</h2><p class="panel-sub">Defina uma nova senha para esta conta. A senha atual não pode ser consultada.</p><form id="resetPasswordForm" class="form-grid" style="margin-top:15px"><input type="hidden" name="username" value="${escapeHtml(username)}"><div class="field"><label>Nova senha (mínimo de 8 caracteres)</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label>Confirmar nova senha</label><input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></div><div class="form-actions full"><button class="btn primary">Salvar nova senha</button><button type="button" class="btn" id="cancelResetPassword">Cancelar</button></div><div class="panel-sub full" id="resetPasswordMessage" role="status"></div></form>`;
    panel.querySelector('[name="password"]').focus();
  });

  document.addEventListener("click", async event => {
    const folderButton = event.target.closest("[data-local-backup-folder]");
    if (folderButton) {
      const status = document.querySelector("#localBackupMessage");
      if (!window.showDirectoryPicker) {
        if (status) status.textContent = "A gravação automática em pasta exige Chrome ou Edge no computador.";
        return;
      }
      folderButton.disabled = true;
      try {
        const handle = await window.showDirectoryPicker({ mode: "readwrite" });
        if (!await hasLocalBackupPermission(handle, true)) {
          throw new Error("Acesso de gravação à pasta não foi autorizado.");
        }
        await storeLocalBackupDirectory(handle);
        startLocalBackupSchedule(handle);
      } catch (error) {
        if (error.name !== "AbortError" && status) {
          status.textContent = `Não foi possível configurar o backup local: ${error.message}`;
        }
      } finally {
        folderButton.disabled = false;
      }
      return;
    }
    const downloadButton = event.target.closest("[data-full-backup-download]");
    if (downloadButton) {
      await downloadFullBackup(downloadButton);
      return;
    }
    if (event.target.closest("[data-full-backup-restore]")) {
      const input = document.querySelector("#fullBackupFile");
      if (input) input.value = "";
      document.querySelector("#fullBackupFile")?.click();
    }
  });

  document.addEventListener("change", async event => {
    if (event.target.id !== "fullBackupFile" || !event.target.files?.[0]) return;
    const file = event.target.files[0];
    const message = document.querySelector("#fullBackupMessage");
    if (file.size > 50_000_000) {
      message.textContent = "O arquivo excede o limite de 50 MB.";
      event.target.value = "";
      return;
    }
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      message.textContent = "O arquivo selecionado não contém um JSON válido.";
      event.target.value = "";
      return;
    }
    const accountCount = Array.isArray(backup.users) ? backup.users.length : 0;
    if (backup.format !== "orbe-full-backup-v1" || accountCount < 1) {
      message.textContent = "Selecione um backup completo do sistema Orbe.";
      event.target.value = "";
      return;
    }
    if (!confirm(
      `Restaurar ${accountCount} conta(s) deste backup? Todos os logins e dados atuais serão substituídos. ` +
      "As senhas de acesso voltarão às que existiam quando o backup foi criado."
    )) {
      event.target.value = "";
      return;
    }
    const button = document.querySelector("[data-full-backup-restore]");
    button.disabled = true;
    message.textContent = "Restaurando todas as contas...";
    try {
      const result = await request("/api/admin/backup/restore", {
        method: "POST",
        body: JSON.stringify(backup)
      });
      alert(result.message);
      location.reload();
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
      event.target.value = "";
    }
  });

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-user]");
    if (!button) return;
    const username = button.dataset.deleteUser;
    if (!confirm(`Excluir o login "${username}" e apagar permanentemente todos os dados dessa conta? Essa ação não pode ser desfeita.`)) return;
    button.disabled = true;
    const message = document.querySelector("#usersMessage");
    try {
      const result = await request(`/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
      message.textContent = result.warning || `O login "${username}" e os dados da conta foram excluídos.`;
      const resetPanel = document.querySelector("#resetPasswordPanel");
      if (resetPanel && resetPanel.textContent.includes(username)) resetPanel.hidden = true;
      await refreshUsers();
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });

  document.addEventListener("click", event => {
    if (event.target.id === "cancelResetPassword") {
      const panel = document.querySelector("#resetPasswordPanel");
      if (panel) panel.hidden = true;
    }
  });

  document.addEventListener("submit", async event => {
    if (event.target.id === "resetPasswordForm") {
      event.preventDefault();
      const form = new FormData(event.target);
      const password = String(form.get("password") || "");
      const message = document.querySelector("#resetPasswordMessage");
      if (password !== form.get("confirmPassword")) {
        message.textContent = "As senhas não conferem.";
        return;
      }
      const button = event.target.querySelector('button[type="submit"], button:not([type])');
      button.disabled = true;
      try {
        await request("/api/admin/users/reset-password", {
          method: "POST",
          body: JSON.stringify({
            username: form.get("username"),
            password
          })
        });
        message.textContent = "Senha redefinida com sucesso.";
        event.target.reset();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    }
    if (event.target.id === "createLoginForm") {
      event.preventDefault();
      const form = new FormData(event.target);
      const message = document.querySelector("#usersMessage");
      const button = event.target.querySelector("button");
      button.disabled = true;
      try {
        await request("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            username: form.get("username"),
            password: form.get("password")
          })
        });
        event.target.reset();
        message.textContent = "Login criado com sucesso.";
        await refreshUsers();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    }
    if (event.target.id === "changePasswordForm") {
      event.preventDefault();
      const form = new FormData(event.target);
      const button = event.target.querySelector("button");
      button.disabled = true;
      try {
        await request("/api/auth/password", {
          method: "POST",
          body: JSON.stringify({
            currentPassword: form.get("currentPassword"),
            password: form.get("password")
          })
        });
        event.target.reset();
        alert("Senha atualizada com sucesso.");
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    }
  });
})();
