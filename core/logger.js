function createLogger(onLog) {
  const emit = (level, message) => {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (typeof onLog === "function") onLog({ level, message: line });
    if (level === "error") console.error(line);
    else console.log(line);
  };
  return {
    info: (msg) => emit("info", msg),
    warn: (msg) => emit("warn", msg),
    error: (msg) => emit("error", msg),
  };
}

module.exports = { createLogger };
