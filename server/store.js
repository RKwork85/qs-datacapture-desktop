const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getControlServerDataDir } = require("../core/paths");

function tasksPath() {
  return path.join(getControlServerDataDir(), "tasks.json");
}

function ensure() {
  fs.mkdirSync(getControlServerDataDir(), { recursive: true });
  const file = tasksPath();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ tasks: [] }, null, 2), "utf8");
  }
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(tasksPath(), "utf8"));
}

function write(data) {
  ensure();
  fs.writeFileSync(tasksPath(), JSON.stringify(data, null, 2), "utf8");
}

function listTasks({ status } = {}) {
  const data = read();
  let tasks = data.tasks || [];
  if (status) tasks = tasks.filter((t) => t.status === status);
  return tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function createTask({ type, params = {}, priority = 0 } = {}) {
  const data = read();
  const task = {
    id: uuidv4(),
    type,
    params,
    priority,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assignedTo: "",
    result: null,
    error: "",
  };
  data.tasks.unshift(task);
  write(data);
  return task;
}

function getTask(id) {
  return (read().tasks || []).find((t) => t.id === id) || null;
}

function updateTask(id, patch) {
  const data = read();
  const idx = data.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  data.tasks[idx] = {
    ...data.tasks[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  write(data);
  return data.tasks[idx];
}

function claimNextTask(clientId) {
  const data = read();
  const pending = (data.tasks || [])
    .filter((t) => t.status === "pending")
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (!pending.length) return null;
  const task = pending[0];
  return updateTask(task.id, {
    status: "running",
    assignedTo: clientId || "",
  });
}

function claimTask(id, clientId) {
  const task = getTask(id);
  if (!task) return null;
  if (task.status !== "pending") return null;
  return updateTask(id, {
    status: "running",
    assignedTo: clientId || "",
  });
}

module.exports = {
  listTasks,
  createTask,
  getTask,
  updateTask,
  claimNextTask,
  claimTask,
};
