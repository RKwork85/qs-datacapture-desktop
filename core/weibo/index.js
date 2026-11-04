const auth = require("./auth");
const { fetchHotSearchToCsv } = require("./hot-search");
const { runDaily } = require("./run-daily");
const { runPipeline } = require("./pipeline");
const {
  fetchDetailFromHotCsv,
  fetchCommentsFromDetailCsv,
  listWeiboDataFiles,
  latestHotCsv,
  latestDetailCsv,
} = require("./tasks");

module.exports = {
  login: auth.loginInteractive,
  authFileLooksValid: auth.authFileLooksValid,
  getAuthStatus: auth.getAuthStatus,
  clearLocalAuth: auth.clearLocalAuth,
  fetchHotSearchToCsv,
  fetchDetailFromHotCsv,
  fetchCommentsFromDetailCsv,
  listWeiboDataFiles,
  latestHotCsv,
  latestDetailCsv,
  runDaily,
  runPipeline,
};
