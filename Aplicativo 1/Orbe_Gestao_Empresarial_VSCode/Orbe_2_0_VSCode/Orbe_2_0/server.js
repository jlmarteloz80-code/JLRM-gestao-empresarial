// ======================================================
// SERVIDOR LOCAL - JLRM GESTÃO EMPRESARIAL PROFISSIONAL
// Requer Node.js 18 ou superior
//
// Como iniciar:
// 1. Salve este arquivo como server.js
// 2. Deixe o index.html na mesma pasta
// 3. Abra o terminal nessa pasta
// 4. Execute: node server.js
// 5. Acesse: http://localhost:3000
//
// Os dados ficam na pasta ./dados em arquivos .txt
// com conteúdo JSON.
// ======================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const ROOT = __dirname;
const LOCAL_DATA = path.join(ROOT, "dados");
const configuredDataDirectory = String(process.env.DATA_DIR || "").trim();
const IS_RENDER = process.env.RENDER === "true";
const DATA = path.resolve(IS_RENDER ? LOCAL_DATA : configuredDataDirectory || LOCAL_DATA);
const BACKUPS = path.join(ROOT, "backups");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const USERS_FILE = path.join(DATA, "logins.txt");
const USER_DATA = path.join(DATA, "usuarios");
const TENANT_MIGRATION_FILE = path.join(DATA, ".usuarios-isolados-v1");
const SESSION_COOKIE = "jlrm_session";
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();

// Arquivos de dados utilizados pelo sistema
const FILES = new Set([
  "lancamentos.txt",
  "contas.txt",
  "clientes.txt",
  "funcionarios.txt",
  "gestores.txt",
  "produtos.txt",
  "metas.txt",
  "investimentos.txt",
  "configuracoes.txt"
]);

// Valores padrão: utilizados somente se o arquivo não existir.
// Arquivos existentes não são sobrescritos na inicialização.
const defaults = {
  "lancamentos.txt": [],
  "contas.txt": [],
  "clientes.txt": [],
  "funcionarios.txt": [],
  "gestores.txt": [],
  "produtos.txt": [],
  "metas.txt": [],
  "investimentos.txt": [],
  "configuracoes.txt": {
    empresa: "JLRM Gestão Empresarial Profissional",
    moeda: "BRL",
    tema: "claro",
    versao: "2.1"
  }
};

// Criar as pastas necessárias
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(BACKUPS, { recursive: true });
if (DATA !== path.resolve(LOCAL_DATA) &&
  !fs.existsSync(path.join(DATA, "logins.txt")) &&
  fs.existsSync(path.join(LOCAL_DATA, "logins.txt"))
) {
  fs.cpSync(LOCAL_DATA, DATA, { recursive: true, force: false });
  console.log(`Dados existentes copiados para o armazenamento persistente: ${DATA}`);
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function readUsersFromFiles() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function writeUsersToFiles(users) {
  const temp = USERS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(users, null, 2), "utf8");
  fs.renameSync(temp, USERS_FILE);
}

function readUsers() {
  return readUsersFromFiles();
}

function writeUsers(users) {
  writeUsersToFiles(users);
}

if (!fs.existsSync(USERS_FILE)) {
  const initialAdminPassword = process.env.ADMIN_INITIAL_PASSWORD || "admin";
  writeUsersToFiles([{
    username: "admin",
    passwordHash: passwordHash(initialAdminPassword),
    role: "admin",
    createdAt: new Date().toISOString()
  }]);
  console.log("Conta inicial de administrador criada.");
}

const savedUsers = readUsersFromFiles();
let removedLegacyLogos = false;
for (const user of savedUsers) {
  if (user.preferences && Object.hasOwn(user.preferences, "logoData")) {
    delete user.preferences.logoData;
    removedLegacyLogos = true;
  }
}
if (removedLegacyLogos) writeUsersToFiles(savedUsers);

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const token = cookie.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL;
  return { token, session };
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicUser(user) {
  return { username: user.username, role: user.role };
}

function defaultPreferences() {
  return {
    empresa: "JLRM Gestão Empresarial Profissional",
    moeda: "BRL",
    tema: "claro",
    saldoInicialCaixa: 0
  };
}

for (const [file, value] of Object.entries(defaults)) {
  const filePath = path.join(DATA, file);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
    console.log(`Arquivo criado: dados/${file}`);
  }
}

// Enviar respostas HTTP
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  res.end(
    typeof body === "string"
      ? body
      : JSON.stringify(body)
  );
}

// Ler o conteúdo enviado pelo navegador
function readBody(req, maxSize = 5_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let oversized = false;

    req.on("data", chunk => {
      if (oversized) return;
      total += chunk.length;

      if (total > maxSize) {
        oversized = true;
        chunks.length = 0;
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (oversized) {
        reject(new Error("O conteúdo enviado é muito grande."));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

// Conferir se um arquivo contém JSON válido
function readJsonFile(file) {
  const filePath = path.join(DATA, file);
  const content = fs.readFileSync(filePath, "utf8");

  return JSON.parse(content);
}

// Salvar arquivo com substituição segura
function writeJsonFile(file, data) {
  const target = path.join(DATA, file);
  const temp = target + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  try {
    fs.renameSync(temp, target);
  } catch (error) {
    if (fs.existsSync(temp)) {
      fs.unlinkSync(temp);
    }

    throw error;
  }
}

function userDataDirectory(username) {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("Nome de usuário inválido para o diretório de dados.");
  }
  return path.join(USER_DATA, username);
}

function ensureUserData(username) {
  const directory = userDataDirectory(username);
  fs.mkdirSync(directory, { recursive: true });
  for (const [file, value] of Object.entries(defaults)) {
    const target = path.join(directory, file);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
    }
  }
  return directory;
}

function readUserJsonFile(username, file) {
  const filePath = path.join(ensureUserData(username), file);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeUserJsonFile(username, file, data) {
  const directory = ensureUserData(username);
  const target = path.join(directory, file);
  const temp = target + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    throw error;
  }
}

function createFullBackupSnapshot() {
  const users = readUsers();
  const accounts = {};
  for (const user of users) {
    userDataDirectory(user.username);
    accounts[user.username] = {};
    for (const file of FILES) {
      accounts[user.username][file.replace(".txt", "")] = readUserJsonFile(user.username, file);
    }
  }
  return {
    app: "Orbe_Gestao_Empresarial",
    format: "orbe-full-backup-v1",
    exportedAt: new Date().toISOString(),
    users,
    accounts
  };
}

function initializeUserData() {
  const users = readUsersFromFiles();
  if (!users.some(user => user.username === "admin" && user.role === "admin")) {
    throw new Error("Conta de administrador ausente; não é possível migrar os dados existentes.");
  }
  if (fs.existsSync(TENANT_MIGRATION_FILE)) {
    for (const user of users) ensureUserData(user.username);
    return;
  }

  const adminDirectory = userDataDirectory("admin");
  const adminDirectoryExisted = fs.existsSync(adminDirectory);
  for (const user of users) ensureUserData(user.username);
  ensureUserData("admin");
  if (!adminDirectoryExisted) {
    for (const file of FILES) {
      const target = path.join(adminDirectory, file);
      const legacySource = path.join(DATA, file);
      if (fs.existsSync(legacySource)) {
        fs.copyFileSync(legacySource, target);
      }
    }
  }

  fs.writeFileSync(TENANT_MIGRATION_FILE, new Date().toISOString(), "utf8");
  console.log("Dados existentes preservados na conta admin; espaços individuais preparados.");
}

initializeUserData();

// Servidor
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    if (url.pathname.startsWith("/api/") &&
        ["POST", "PUT", "DELETE"].includes(req.method) &&
        !isSameOrigin(req)) {
      return send(res, 403, { error: "Origem da solicitação não permitida." });
    }

    if (url.pathname === "/api/auth/session" && req.method === "GET") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      return send(res, 200, { user: publicUser(current.session.user) });
    }

    if (url.pathname === "/api/auth/preferences" && req.method === "GET") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      const user = (await readUsers()).find(entry => entry.username === current.session.user.username);
      if (!user) return send(res, 401, { error: "Conta de usuário não encontrada." });
      return send(res, 200, {
        preferences: {
          ...defaultPreferences(),
          empresa: user.preferences?.empresa || defaultPreferences().empresa,
          moeda: user.preferences?.moeda || defaultPreferences().moeda,
          tema: user.preferences?.tema || defaultPreferences().tema,
          saldoInicialCaixa: Number(user.preferences?.saldoInicialCaixa) || 0
        }
      });
    }

    if (url.pathname === "/api/auth/preferences" && req.method === "PUT") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: "Preferências inválidas." });
      }
      const empresa = String(input.empresa || "").trim();
      const moeda = String(input.moeda || "");
      const tema = String(input.tema || "");
      const saldoInicialCaixa = Number(input.saldoInicialCaixa ?? 0);
      if (!empresa || empresa.length > 80) {
        return send(res, 400, { error: "Informe o nome da empresa (máximo de 80 caracteres)." });
      }
      if (!["BRL", "USD", "EUR"].includes(moeda) || !["claro", "escuro"].includes(tema)) {
        return send(res, 400, { error: "Moeda ou tema inválido." });
      }
      if (!Number.isFinite(saldoInicialCaixa) || saldoInicialCaixa < 0 || saldoInicialCaixa > 1_000_000_000_000) {
        return send(res, 400, { error: "Informe um saldo inicial de caixa válido." });
      }
      const users = await readUsers();
      const user = users.find(entry => entry.username === current.session.user.username);
      if (!user) return send(res, 401, { error: "Conta de usuário não encontrada." });
      const preferences = { empresa, moeda, tema, saldoInicialCaixa };
      user.preferences = preferences;
      await writeUsers(users);
      return send(res, 200, { ok: true, preferences });
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const address = req.socket.remoteAddress || "local";
      const attempts = loginAttempts.get(address) || { count: 0, blockedUntil: 0 };
      if (attempts.blockedUntil > Date.now()) {
        return send(res, 429, { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
      }

      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: "Dados de login inválidos." });
      }
      const username = String(input.username || "").trim().toLowerCase();
      const password = String(input.password || "");
      const users = await readUsers();
      const user = users.find(entry => entry.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        attempts.count += 1;
        if (attempts.count >= 5) {
          attempts.count = 0;
          attempts.blockedUntil = Date.now() + 15 * 60 * 1000;
        }
        loginAttempts.set(address, attempts);
        return send(res, 401, { error: "Usuário ou senha incorretos." });
      }

      loginAttempts.delete(address);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { user: publicUser(user), expiresAt: Date.now() + SESSION_TTL });
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`);
      return send(res, 200, { user: publicUser(user) });
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const current = getSession(req);
      if (current) sessions.delete(current.token);
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/auth/password" && req.method === "POST") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: "Dados inválidos." });
      }
      const password = String(input.password || "");
      if (password.length < 8) {
        return send(res, 400, { error: "A nova senha deve ter pelo menos 8 caracteres." });
      }
      const users = await readUsers();
      const user = users.find(entry => entry.username === current.session.user.username);
      if (!user || !verifyPassword(String(input.currentPassword || ""), user.passwordHash)) {
        return send(res, 401, { error: "A senha atual está incorreta." });
      }
      user.passwordHash = passwordHash(password);
      await writeUsers(users);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/api/admin/users" && req.method === "GET") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      if (current.session.user.role !== "admin") {
        return send(res, 403, { error: "Somente o admin pode gerenciar logins." });
      }
      return send(res, 200, { users: (await readUsers()).map(publicUser) });
    }

    if (url.pathname === "/api/admin/backup" && req.method === "GET") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      if (current.session.user.role !== "admin") {
        return send(res, 403, { error: "Somente o admin pode baixar o backup completo." });
      }

      const backup = JSON.stringify(createFullBackupSnapshot(), null, 2);
      const filename = `orbe_backup_completo_${new Date().toISOString().slice(0, 10)}.json`;
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return res.end(backup);
    }

    if (url.pathname === "/api/admin/backup/restore" && req.method === "POST") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      if (current.session.user.role !== "admin") {
        return send(res, 403, { error: "Somente o admin pode restaurar o backup completo." });
      }

      let backup;
      try {
        backup = JSON.parse(await readBody(req, 50_000_000));
      } catch (error) {
        return send(res, 400, {
          error: error.message === "O conteúdo enviado é muito grande."
            ? "O backup excede o limite de 50 MB."
            : "O arquivo enviado não contém um JSON válido."
        });
      }
      if (!backup || backup.format !== "orbe-full-backup-v1" ||
          !Array.isArray(backup.users) || !backup.accounts ||
          typeof backup.accounts !== "object" || Array.isArray(backup.accounts)) {
        return send(res, 400, { error: "Formato de backup completo inválido ou não reconhecido." });
      }

      const usernames = new Set();
      let hasAdmin = false;
      for (const user of backup.users) {
        if (!user || typeof user !== "object" || Array.isArray(user) ||
            !/^[a-z0-9._-]{3,32}$/.test(String(user.username || "")) ||
            !/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(String(user.passwordHash || "")) ||
            !["admin", "user"].includes(user.role) ||
            (user.preferences !== undefined &&
              (!user.preferences || typeof user.preferences !== "object" || Array.isArray(user.preferences)))) {
          return send(res, 400, { error: "O backup contém uma conta inválida." });
        }
        if (usernames.has(user.username)) {
          return send(res, 400, { error: "O backup contém nomes de usuário repetidos." });
        }
        usernames.add(user.username);
        if (user.username === "admin" && user.role === "admin") hasAdmin = true;
      }
      if (!hasAdmin || usernames.size === 0) {
        return send(res, 400, { error: "O backup precisa conter a conta principal admin." });
      }

      const accountNames = Object.keys(backup.accounts);
      if (accountNames.length !== usernames.size ||
          accountNames.some(username => !usernames.has(username))) {
        return send(res, 400, { error: "As contas e os dados incluídos no backup não correspondem." });
      }
      for (const username of usernames) {
        const account = backup.accounts[username];
        if (!account || typeof account !== "object" || Array.isArray(account)) {
          return send(res, 400, { error: `Os dados da conta "${username}" são inválidos.` });
        }
        for (const file of FILES) {
          const value = account[file.replace(".txt", "")];
          const isSettings = file === "configuracoes.txt";
          if (isSettings
            ? (!value || typeof value !== "object" || Array.isArray(value))
            : !Array.isArray(value)) {
            return send(res, 400, { error: `O backup não contém dados válidos para ${username}/${file}.` });
          }
        }
      }

      const restoreDirectory = path.join(DATA, `.restore-${crypto.randomBytes(12).toString("hex")}`);
      const stagedUsersDirectory = path.join(restoreDirectory, "usuarios");
      const previousUsersDirectory = path.join(restoreDirectory, "usuarios-anteriores");
      const stagedLoginsFile = path.join(restoreDirectory, "logins.txt");
      const previousLoginsFile = path.join(restoreDirectory, "logins-anteriores.txt");
      const stagedMigrationFile = path.join(restoreDirectory, ".usuarios-isolados-v1");
      const previousMigrationFile = path.join(restoreDirectory, ".usuarios-isolados-anteriores");
      let preserveRestoreDirectory = false;
      let restoreStarted = false;

      try {
        fs.mkdirSync(stagedUsersDirectory, { recursive: true });
        if (fs.existsSync(USER_DATA)) {
          fs.cpSync(USER_DATA, previousUsersDirectory, { recursive: true, errorOnExist: true });
        } else {
          fs.mkdirSync(previousUsersDirectory);
        }
        fs.copyFileSync(USERS_FILE, previousLoginsFile);
        if (fs.existsSync(TENANT_MIGRATION_FILE)) {
          fs.copyFileSync(TENANT_MIGRATION_FILE, previousMigrationFile);
        }
        for (const username of usernames) {
          const accountDirectory = path.join(stagedUsersDirectory, username);
          fs.mkdirSync(accountDirectory);
          for (const file of FILES) {
            fs.writeFileSync(
              path.join(accountDirectory, file),
              JSON.stringify(backup.accounts[username][file.replace(".txt", "")], null, 2),
              "utf8"
            );
          }
        }
        fs.writeFileSync(stagedLoginsFile, JSON.stringify(backup.users, null, 2), "utf8");
        fs.writeFileSync(stagedMigrationFile, new Date().toISOString(), "utf8");

        restoreStarted = true;
        fs.mkdirSync(USER_DATA, { recursive: true });
        for (const username of usernames) {
          fs.cpSync(
            path.join(stagedUsersDirectory, username),
            userDataDirectory(username),
            { recursive: true, force: true }
          );
        }
        for (const entry of fs.readdirSync(USER_DATA, { withFileTypes: true })) {
          if (entry.isDirectory() && /^[a-z0-9._-]{3,32}$/.test(entry.name) &&
              !usernames.has(entry.name)) {
            fs.rmSync(path.join(USER_DATA, entry.name), { recursive: true, force: false });
          }
        }
        writeUsersToFiles(backup.users);
        const migrationTempFile = TENANT_MIGRATION_FILE + ".tmp";
        fs.copyFileSync(stagedMigrationFile, migrationTempFile);
        fs.renameSync(migrationTempFile, TENANT_MIGRATION_FILE);
      } catch (error) {
        if (!restoreStarted) {
          console.error("Não foi possível preparar o backup para restauração:", error);
          return send(res, 500, {
            error: "Não foi possível preparar o backup para restauração.",
            code: error.code || "RESTORE_PREPARATION_FAILED",
            detail: error.message
          });
        }
        try {
          fs.mkdirSync(USER_DATA, { recursive: true });
          for (const entry of fs.readdirSync(USER_DATA, { withFileTypes: true })) {
            if (entry.isDirectory() && /^[a-z0-9._-]{3,32}$/.test(entry.name)) {
              fs.rmSync(path.join(USER_DATA, entry.name), { recursive: true, force: false });
            }
          }
          for (const entry of fs.readdirSync(previousUsersDirectory, { withFileTypes: true })) {
            if (entry.isDirectory() && /^[a-z0-9._-]{3,32}$/.test(entry.name)) {
              fs.cpSync(
                path.join(previousUsersDirectory, entry.name),
                userDataDirectory(entry.name),
                { recursive: true, force: true }
              );
            }
          }
          fs.copyFileSync(previousLoginsFile, USERS_FILE);
          if (fs.existsSync(previousMigrationFile)) {
            const migrationTempFile = TENANT_MIGRATION_FILE + ".tmp";
            fs.copyFileSync(previousMigrationFile, migrationTempFile);
            fs.renameSync(migrationTempFile, TENANT_MIGRATION_FILE);
          } else if (fs.existsSync(TENANT_MIGRATION_FILE)) {
            fs.unlinkSync(TENANT_MIGRATION_FILE);
          }
        } catch (rollbackError) {
          preserveRestoreDirectory = true;
          console.error(
            `Falha ao reverter a restauração. Os dados anteriores foram preservados em ${restoreDirectory}:`,
            rollbackError
          );
          console.error("Erro original durante a restauração do backup:", error);
          return send(res, 500, {
            error: "A restauração falhou e não foi possível reverter automaticamente.",
            code: rollbackError.code || "RESTORE_ROLLBACK_FAILED",
            detail: `${rollbackError.message}. Os dados anteriores foram preservados em ${restoreDirectory}.`
          });
        }
        console.error("Erro ao restaurar backup completo:", error);
        return send(res, 500, {
          error: "Não foi possível restaurar o backup completo.",
          code: error.code || "RESTORE_FAILED",
          detail: error.message
        });
      } finally {
        if (!preserveRestoreDirectory && fs.existsSync(restoreDirectory)) {
          try {
            fs.rmSync(restoreDirectory, { recursive: true, force: false });
          } catch (cleanupError) {
            console.error(`Não foi possível limpar os arquivos temporários de restauração ${restoreDirectory}:`, cleanupError);
          }
        }
      }

      sessions.clear();
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
      console.log(`Backup completo restaurado pelo admin ${current.session.user.username}: ${usernames.size} conta(s).`);
      return send(res, 200, {
        ok: true,
        usersRestored: usernames.size,
        message: "Backup completo restaurado. Entre novamente com os dados de acesso incluídos no backup."
      });
    }

    if (url.pathname === "/api/admin/users" && req.method === "POST") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      if (current.session.user.role !== "admin") {
        return send(res, 403, { error: "Somente o admin pode criar logins." });
      }
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: "Dados do usuário inválidos." });
      }
      const username = String(input.username || "").trim().toLowerCase();
      const password = String(input.password || "");
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        return send(res, 400, { error: "Use um usuário de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado." });
      }
      if (password.length < 8) {
        return send(res, 400, { error: "A senha deve ter pelo menos 8 caracteres." });
      }
      const users = await readUsers();
      if (users.some(user => user.username === username)) {
        return send(res, 409, { error: "Esse nome de usuário já existe." });
      }
      const newUser = {
        username,
        passwordHash: passwordHash(password),
        role: "user",
        preferences: defaultPreferences(),
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      ensureUserData(username);
      await writeUsers(users);
      return send(res, 201, { ok: true, username });
    }

    if (url.pathname === "/api/admin/users/reset-password" && req.method === "POST") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      if (current.session.user.role !== "admin") {
        return send(res, 403, { error: "Somente o admin pode redefinir senhas." });
      }
      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: "Dados inválidos." });
      }
      const username = String(input.username || "").trim().toLowerCase();
      const password = String(input.password || "");
      if (password.length < 8) {
        return send(res, 400, { error: "A nova senha deve ter pelo menos 8 caracteres." });
      }
      const users = await readUsers();
      const user = users.find(entry => entry.username === username);
      if (!user) {
        return send(res, 404, { error: "Login não encontrado." });
      }
      user.passwordHash = passwordHash(password);
      await writeUsers(users);
      for (const [token, session] of sessions) {
        if (session.user.username === username && token !== current.token) {
          sessions.delete(token);
        }
      }
      return send(res, 200, { ok: true, username });
    }

    const deleteUserMatch = url.pathname.match(/^\/api\/admin\/users\/([a-z0-9._-]{3,32})$/);
    if (deleteUserMatch && req.method === "DELETE") {
      const current = getSession(req);
      if (!current) return send(res, 401, { error: "Faça login para continuar." });
      if (current.session.user.role !== "admin") {
        return send(res, 403, { error: "Somente o admin pode excluir logins." });
      }
      const username = deleteUserMatch[1];
      if (username === "admin") {
        return send(res, 400, { error: "A conta principal de administrador não pode ser excluída." });
      }
      const users = await readUsers();
      const user = users.find(entry => entry.username === username);
      if (!user) return send(res, 404, { error: "Login não encontrado." });
      if (user.role === "admin") {
        return send(res, 400, { error: "Não é permitido excluir uma conta de administrador." });
      }

      const userDirectory = userDataDirectory(username);
      const archivedDirectory = path.join(
        USER_DATA,
        `.deleted-${username}-${crypto.randomBytes(8).toString("hex")}`
      );
      let movedUserData = false;
      if (fs.existsSync(userDirectory)) {
        fs.renameSync(userDirectory, archivedDirectory);
        movedUserData = true;
      }

      try {
        await writeUsers(users.filter(entry => entry.username !== username));
      } catch (error) {
        if (movedUserData) fs.renameSync(archivedDirectory, userDirectory);
        throw error;
      }
      if (movedUserData) {
        try {
          fs.rmSync(archivedDirectory, { recursive: true, force: false });
        } catch (error) {
          console.error(`Login ${username} excluído, mas os dados isolados não puderam ser apagados:`, error);
          return send(res, 200, {
            ok: true,
            username,
            warning: `O login foi excluído, mas não foi possível apagar os dados da conta. Verifique a pasta dados/usuarios no servidor.`
          });
        }
      }

      for (const [token, session] of sessions) {
        if (session.user.username === username) sessions.delete(token);
      }

      return send(res, 200, { ok: true, username });
    }

    // ------------------------------------------
    // CONSULTAR TODOS OS DADOS
    // GET /api/dados
    // ------------------------------------------
    if (
      url.pathname === "/api/dados" &&
      req.method === "GET"
    ) {
      const current = getSession(req);
      if (!current) {
        return send(res, 401, { error: "Faça login para continuar." });
      }
      const output = {};

      for (const file of FILES) {
        const key = file.replace(".txt", "");

        try {
          output[key] = readUserJsonFile(current.session.user.username, file);
        } catch (error) {
          console.error(
            `Erro ao ler dados/${file}:`,
            error.message
          );

          return send(res, 500, {
            error: `Não foi possível ler ${file}.`,
            detalhe: "Verifique se o arquivo contém JSON válido."
          });
        }
      }

      return send(res, 200, output);
    }

    // ------------------------------------------
    // SALVAR DADOS
    // PUT /api/dados/lancamentos
    // PUT /api/dados/contas
    // PUT /api/dados/clientes
    // PUT /api/dados/funcionarios
    // PUT /api/dados/gestores
    // PUT /api/dados/produtos
    // PUT /api/dados/metas
    // PUT /api/dados/investimentos
    // PUT /api/dados/configuracoes
    // ------------------------------------------
    const match = url.pathname.match(
      /^\/api\/dados\/([a-z]+)$/
    );

    if (match && req.method === "PUT") {
      const current = getSession(req);
      if (!current) {
        return send(res, 401, { error: "Faça login para continuar." });
      }
      const key = match[1];
      const file = key + ".txt";

      if (!FILES.has(file)) {
        return send(res, 404, {
          error: "Arquivo de dados não reconhecido."
        });
      }

      let raw;
      let data;

      try {
        raw = await readBody(req);
        data = JSON.parse(raw);
      } catch (error) {
        return send(res, 400, {
          error: "O conteúdo enviado não é um JSON válido."
        });
      }

      if (
        data === null ||
        typeof data !== "object"
      ) {
        return send(res, 400, {
          error: "Formato de dados inválido."
        });
      }

      try {
        writeUserJsonFile(current.session.user.username, file, data);

        console.log(
          `[${new Date().toLocaleString("pt-BR")}] ` +
          `Dados salvos: dados/usuarios/${current.session.user.username}/${file}`
        );

        return send(res, 200, {
          ok: true,
          arquivo: file,
          mensagem: "Dados salvos com sucesso."
        });
      } catch (error) {
        console.error(
          `Erro ao salvar dados/${file}:`,
          error
        );

        return send(res, 500, {
          error: "Não foi possível salvar os dados.",
          code: error.code || "UNKNOWN"
        });
      }
    }

    if (url.pathname === "/auth.js" && req.method === "GET") {
      const authPath = path.join(ROOT, "auth.js");
      if (!fs.existsSync(authPath)) {
        return send(res, 404, "Arquivo de autenticação não encontrado.", "text/plain; charset=utf-8");
      }
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return fs.createReadStream(authPath).pipe(res);
    }

    const staticFiles = {
      "/sw.js": ["sw.js", "application/javascript; charset=utf-8"],
      "/investment-simulations.js": ["investment-simulations.js", "application/javascript; charset=utf-8"],
      "/account-installments.js": ["account-installments.js", "application/javascript; charset=utf-8"],
      "/negative-balance-warning.js": ["negative-balance-warning.js", "application/javascript; charset=utf-8"],
      "/goal-management.js": ["goal-management.js", "application/javascript; charset=utf-8"],
      "/icon.svg": ["icon.svg", "image/svg+xml"]
    };
    if (staticFiles[url.pathname] && req.method === "GET") {
      const [fileName, contentType] = staticFiles[url.pathname];
      const filePath = path.join(ROOT, fileName);
      if (!fs.existsSync(filePath)) {
        return send(res, 404, "Arquivo não encontrado.", "text/plain; charset=utf-8");
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": fileName.endsWith(".js") ? "no-cache" : "public, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    if (url.pathname === "/manifest.webmanifest" && req.method === "GET") {
      const current = getSession(req);
      const user = current
        ? (await readUsers()).find(entry => entry.username === current.session.user.username)
        : null;
      const preferences = { ...defaultPreferences(), ...(user?.preferences || {}) };
      return send(res, 200, {
        id: "/",
        name: preferences.empresa,
        short_name: preferences.empresa.slice(0, 24),
        description: `Aplicativo de gestão empresarial de ${preferences.empresa}`,
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: preferences.tema === "escuro" ? "#0b1120" : "#f3f5fa",
        theme_color: "#111827",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
      }, "application/manifest+json; charset=utf-8");
    }

    // ------------------------------------------
    // PÁGINA PRINCIPAL
    // GET /
    // GET /index.html
    // ------------------------------------------
    if (
      url.pathname === "/" ||
      url.pathname === "/index.html"
    ) {
      const indexPath = path.join(ROOT, "index.html");

      if (!fs.existsSync(indexPath)) {
        return send(
          res,
          404,
          "O arquivo index.html não foi encontrado.",
          "text/plain; charset=utf-8"
        );
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });

      return fs.createReadStream(indexPath).pipe(res);
    }

    // ------------------------------------------
    // FAVICON
    // ------------------------------------------
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }

    // ------------------------------------------
    // ROTA NÃO ENCONTRADA
    // ------------------------------------------
    return send(res, 404, {
      error: "Página ou recurso não encontrado."
    });

  } catch (error) {
    console.error("Erro interno do servidor:", error);

    if (!res.headersSent) {
      return send(res, 500, {
        error: "Ocorreu um erro interno no servidor."
      });
    }

    res.end();
  }
})

// Iniciar servidor
function startServer() {
  server.listen(PORT, HOST, () => {
  console.log("");
  console.log("==============================================");
  console.log(" JLRM GESTÃO EMPRESARIAL PROFISSIONAL");
  console.log(" Servidor iniciado com sucesso!");
  console.log("==============================================");
  console.log(`Endereço local: http://localhost:${PORT}`);
  const addresses = Object.values(os.networkInterfaces()).flat()
    .filter(address => address && address.family === "IPv4" && !address.internal)
    .map(address => address.address);
  for (const address of addresses) {
    console.log(`Acesso na rede Wi-Fi: http://${address}:${PORT}`);
  }
  console.log("Acesso pela rede local: use apenas em uma rede privada e confiável.");
  console.log(`Pasta de dados: ${DATA}`);
  console.log(`Persistência: arquivos em ${DATA}`);
  console.log(`Pasta de backups: ${BACKUPS}`);
  console.log("Para encerrar, pressione Ctrl+C.");
  console.log("==============================================");
  console.log("");
})

// Mostrar erros de inicialização
server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `A porta ${PORT} já está sendo utilizada. ` +
      "Feche o outro servidor ou escolha outra porta."
    );
  } else {
    console.error("Erro no servidor:", error);
  }
  });
}

startServer();